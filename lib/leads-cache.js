import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { parse as parseCsv } from "csv-parse/sync";
import { dbQuery, getDbPool, hasDatabaseConnection } from "./db";
import { getOrFetchWeatherRange } from "./weather-cache";
import { loadMarketsConfig } from "./markets";

const LEAD_DATE_COLUMN = "EstimateRequestedDate";
const LEAD_SOURCE_COLUMN = "ProgramSourceDescription";
const SYNC_TTL_MS = 5 * 60 * 1000;
const PRIORITY_MARKET_KEYWORDS = [
  "west chester",
  "north wales",
  "hillsborough",
  "lindenwold",
];

let lastSyncAt = 0;
let lastSyncReport = null;

function normalizeHeaderKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isInSeason(date) {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const md = month * 100 + day;
  return md >= 215 && md <= 517;
}

function normalizeDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (us) {
      const month = Number(us[1]);
      const day = Number(us[2]);
      const yearRaw = Number(us[3]);
      const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return new Date(
        Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
      );
    }
  }

  return null;
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

async function ensureLeadSchema() {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS leads_daily_source (
      lead_date DATE NOT NULL,
      lead_source TEXT NOT NULL,
      lead_count INTEGER NOT NULL,
      source_file TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (lead_date, lead_source, source_file)
    );
  `);

  await dbQuery(`
    CREATE INDEX IF NOT EXISTS leads_daily_source_date_idx
    ON leads_daily_source (lead_date);
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS leads_ingest_file (
      source_file TEXT PRIMARY KEY,
      file_sha256 TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function listCandidateLeadFiles() {
  const entries = await readdir(process.cwd(), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => entry.name);
}

function parseLeadCsv(raw) {
  const rows = parseCsv(raw, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });

  const headers = Object.keys(rows[0] || {});
  const normalized = new Map(headers.map((header) => [normalizeHeaderKey(header), header]));
  const dateHeader = normalized.get(normalizeHeaderKey(LEAD_DATE_COLUMN));
  const sourceHeader = normalized.get(normalizeHeaderKey(LEAD_SOURCE_COLUMN));

  if (!dateHeader || !sourceHeader) {
    return null;
  }

  return {
    rows,
    dateHeader,
    sourceHeader,
  };
}

function aggregateLeadRows(rows, dateHeader, sourceHeader) {
  const counts = new Map();
  let parsedRows = 0;

  for (const row of rows) {
    const date = normalizeDate(row[dateHeader]);
    if (!date || !isInSeason(date)) continue;

    const source = String(row[sourceHeader] || "Unknown").trim() || "Unknown";
    const iso = toISODate(date);
    const key = `${iso}|||${source}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    parsedRows += 1;
  }

  return {
    counts,
    parsedRows,
  };
}

async function getStoredFileHash(sourceFile) {
  const result = await dbQuery(
    `
      SELECT file_sha256
      FROM leads_ingest_file
      WHERE source_file = $1;
    `,
    [sourceFile],
  );
  return result.rows[0]?.file_sha256 || null;
}

async function replaceFileAggregates(sourceFile, fileHash, aggregated) {
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `
        DELETE FROM leads_daily_source
        WHERE source_file = $1;
      `,
      [sourceFile],
    );

    const entries = [...aggregated.counts.entries()];
    if (entries.length) {
      const values = [];
      const placeholders = [];

      entries.forEach(([key, count], index) => {
        const [date, source] = key.split("|||");
        const base = index * 4;
        placeholders.push(
          `($${base + 1}::date, $${base + 2}, $${base + 3}, $${base + 4})`,
        );
        values.push(date, source, count, sourceFile);
      });

      await client.query(
        `
          INSERT INTO leads_daily_source (
            lead_date,
            lead_source,
            lead_count,
            source_file
          )
          VALUES ${placeholders.join(", ")}
          ON CONFLICT (lead_date, lead_source, source_file)
          DO UPDATE SET
            lead_count = EXCLUDED.lead_count,
            updated_at = now();
        `,
        values,
      );
    }

    await client.query(
      `
        INSERT INTO leads_ingest_file (
          source_file,
          file_sha256,
          row_count,
          processed_at
        )
        VALUES ($1, $2, $3, now())
        ON CONFLICT (source_file)
        DO UPDATE SET
          file_sha256 = EXCLUDED.file_sha256,
          row_count = EXCLUDED.row_count,
          processed_at = now();
      `,
      [sourceFile, fileHash, aggregated.parsedRows],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function syncLeadFilesToDb() {
  if (!hasDatabaseConnection()) {
    throw new Error(
      "Database connection is missing. Set POSTGRES_URL or DATABASE_URL in environment variables.",
    );
  }

  await ensureLeadSchema();

  const now = Date.now();
  if (lastSyncReport && now - lastSyncAt < SYNC_TTL_MS) {
    return {
      ...lastSyncReport,
      cached: true,
      lastSyncAt: new Date(lastSyncAt).toISOString(),
    };
  }

  const files = await listCandidateLeadFiles();
  const report = {
    processed: [],
    skipped: [],
    ignored: [],
  };

  for (const sourceFile of files) {
    const absolutePath = path.join(process.cwd(), sourceFile);
    const raw = await readFile(absolutePath, "utf8");
    const parsed = parseLeadCsv(raw);
    if (!parsed) {
      report.ignored.push({ sourceFile, reason: "missing-required-columns" });
      continue;
    }

    const fileHash = createHash("sha256").update(raw).digest("hex");
    const storedHash = await getStoredFileHash(sourceFile);
    if (storedHash && storedHash === fileHash) {
      report.skipped.push({ sourceFile, reason: "unchanged" });
      continue;
    }

    const aggregated = aggregateLeadRows(
      parsed.rows,
      parsed.dateHeader,
      parsed.sourceHeader,
    );
    await replaceFileAggregates(sourceFile, fileHash, aggregated);
    report.processed.push({
      sourceFile,
      parsedRows: aggregated.parsedRows,
      aggregatedRows: aggregated.counts.size,
    });
  }

  lastSyncAt = Date.now();
  lastSyncReport = report;

  return {
    ...report,
    cached: false,
    lastSyncAt: new Date(lastSyncAt).toISOString(),
  };
}

function seasonDayKey(isoDate) {
  return isoDate.slice(5);
}

function getSeasonWindow(year, today) {
  const start = `${year}-02-15`;
  const endPlanned = `${year}-05-17`;
  const todayISO = toISODate(today);
  const isCurrentYear = year === today.getUTCFullYear();
  const end = isCurrentYear && todayISO < endPlanned ? todayISO : endPlanned;
  return { start, end };
}

function enumerateDates(startISO, endISO) {
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  const out = [];

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    out.push(toISODate(cursor));
  }

  return out;
}

function pickPriorityMarkets(markets) {
  const picked = markets.filter((market) => {
    const haystack = `${market?.name || ""} ${market?.label || ""}`.toLowerCase();
    return PRIORITY_MARKET_KEYWORDS.some((keyword) => haystack.includes(keyword));
  });

  if (picked.length) return picked.map((market) => market.name);
  return markets.slice(0, 4).map((market) => market.name);
}

async function getTopSources(startDate, endDate) {
  const result = await dbQuery(
    `
      SELECT
        lead_source AS source,
        SUM(lead_count)::int AS count
      FROM leads_daily_source
      WHERE lead_date BETWEEN $1::date AND $2::date
      GROUP BY lead_source
      ORDER BY count DESC, source ASC
      LIMIT 25;
    `,
    [startDate, endDate],
  );
  return result.rows;
}

async function getDailyLeadRows(startDate, endDate, sourceFilter) {
  const normalizedSource = (sourceFilter || "All Sources").trim();
  const useAllSources =
    !normalizedSource || normalizedSource.toLowerCase() === "all sources";

  if (useAllSources) {
    const result = await dbQuery(
      `
        SELECT
          lead_date::text AS date,
          SUM(lead_count)::int AS total_leads,
          SUM(
            CASE
              WHEN UPPER(lead_source) LIKE 'DM%' OR UPPER(lead_source) LIKE '%DIRECT MAIL%'
                THEN lead_count
              ELSE 0
            END
          )::int AS direct_mail_leads,
          SUM(lead_count)::int AS filtered_leads
        FROM leads_daily_source
        WHERE lead_date BETWEEN $1::date AND $2::date
        GROUP BY lead_date
        ORDER BY lead_date;
      `,
      [startDate, endDate],
    );
    return result.rows;
  }

  const result = await dbQuery(
    `
      SELECT
        lead_date::text AS date,
        SUM(lead_count)::int AS total_leads,
        SUM(
          CASE
            WHEN UPPER(lead_source) LIKE 'DM%' OR UPPER(lead_source) LIKE '%DIRECT MAIL%'
              THEN lead_count
            ELSE 0
          END
        )::int AS direct_mail_leads,
        SUM(
          CASE
            WHEN lead_source = $3
              THEN lead_count
            ELSE 0
          END
        )::int AS filtered_leads
      FROM leads_daily_source
      WHERE lead_date BETWEEN $1::date AND $2::date
      GROUP BY lead_date
      ORDER BY lead_date;
    `,
    [startDate, endDate, normalizedSource],
  );
  return result.rows;
}

async function getPriorityWeatherByDate(priorityMarketNames, startDate, endDate, weatherApiKey) {
  if (!weatherApiKey || !priorityMarketNames.length) {
    return { byDate: new Map(), storageModes: ["not-requested"] };
  }

  const aggregate = new Map();
  const storageModes = new Set();

  for (const marketName of priorityMarketNames) {
    const weatherRange = await getOrFetchWeatherRange({
      marketName,
      startDate,
      endDate,
      apiKey: weatherApiKey,
    });
    storageModes.add(weatherRange.storage);

    for (const day of weatherRange.days || []) {
      const entry =
        aggregate.get(day.datetime) || {
          count: 0,
          tempmaxSum: 0,
          uvSum: 0,
          snowDepthSum: 0,
        };

      const tempmax = Number(day.tempmax);
      const uv = Number(day.uvindex);
      const snowDepth = Number(day.snowdepth);

      entry.count += 1;
      entry.tempmaxSum += Number.isFinite(tempmax) ? tempmax : 0;
      entry.uvSum += Number.isFinite(uv) ? uv : 0;
      entry.snowDepthSum += Number.isFinite(snowDepth) ? snowDepth : 0;
      aggregate.set(day.datetime, entry);
    }
  }

  const byDate = new Map();
  for (const [date, entry] of aggregate.entries()) {
    const count = entry.count || 1;
    byDate.set(date, {
      avgTempMax: entry.tempmaxSum / count,
      avgUv: entry.uvSum / count,
      avgSnowDepth: entry.snowDepthSum / count,
    });
  }

  return {
    byDate,
    storageModes: [...storageModes],
  };
}

function buildWeatherImpact(rows) {
  const withWeather = rows.filter((row) => row.weather);
  if (!withWeather.length) {
    return {
      avgLeadsSnowDays: null,
      avgLeadsClearDays: null,
      avgLeadsColdDays: null,
      avgLeadsWarmDays: null,
      sampleSize: {
        snowDays: 0,
        clearDays: 0,
        coldDays: 0,
        warmDays: 0,
      },
    };
  }

  const avg = (input, key) =>
    input.length
      ? input.reduce((sum, row) => sum + row[key], 0) / input.length
      : null;

  const snowDays = withWeather.filter((row) => (row.weather.avgSnowDepth ?? 0) > 0);
  const clearDays = withWeather.filter((row) => (row.weather.avgSnowDepth ?? 0) <= 0);
  const coldDays = withWeather.filter((row) => (row.weather.avgTempMax ?? 999) < 45);
  const warmDays = withWeather.filter((row) => (row.weather.avgTempMax ?? -999) >= 55);

  return {
    avgLeadsSnowDays: avg(snowDays, "filteredLeads"),
    avgLeadsClearDays: avg(clearDays, "filteredLeads"),
    avgLeadsColdDays: avg(coldDays, "filteredLeads"),
    avgLeadsWarmDays: avg(warmDays, "filteredLeads"),
    sampleSize: {
      snowDays: snowDays.length,
      clearDays: clearDays.length,
      coldDays: coldDays.length,
      warmDays: warmDays.length,
    },
  };
}

export async function getLeadOverview({
  year,
  compareYears = [],
  sourceFilter = "All Sources",
  weatherApiKey,
}) {
  if (!hasDatabaseConnection()) {
    throw new Error(
      "Database connection is missing. Set POSTGRES_URL or DATABASE_URL in environment variables.",
    );
  }

  const yearsResult = await dbQuery(`
    SELECT
      EXTRACT(YEAR FROM lead_date)::int AS year,
      SUM(lead_count)::int AS total_leads,
      SUM(
        CASE
          WHEN UPPER(lead_source) LIKE 'DM%' OR UPPER(lead_source) LIKE '%DIRECT MAIL%'
            THEN lead_count
          ELSE 0
        END
      )::int AS direct_mail_leads
    FROM leads_daily_source
    GROUP BY EXTRACT(YEAR FROM lead_date)
    ORDER BY year;
  `);

  const availableYears = yearsResult.rows.map((row) => row.year);
  if (!availableYears.length) {
    return {
      availableYears: [],
      selectedYear: null,
      seasonWindow: null,
      totals: null,
      topSources: [],
      daily: [],
      weatherImpact: null,
      weatherStorage: "none",
    };
  }

  const selectedYear = availableYears.includes(year)
    ? year
    : availableYears[availableYears.length - 1];
  const today = new Date();
  const selectedWindow = getSeasonWindow(selectedYear, today);

  const topSources = await getTopSources(selectedWindow.start, selectedWindow.end);
  const sourceOptions = ["All Sources", ...topSources.map((row) => row.source)];
  const normalizedSource = sourceOptions.includes(sourceFilter)
    ? sourceFilter
    : "All Sources";

  const marketsConfig = await loadMarketsConfig();
  const priorityMarkets = pickPriorityMarkets(marketsConfig.markets || []);

  const requestedCompareYears = Array.isArray(compareYears)
    ? compareYears.filter((value) => Number.isFinite(value))
    : [];

  let selectedCompareYears = requestedCompareYears.filter((value) =>
    availableYears.includes(value),
  );
  if (!selectedCompareYears.length) {
    selectedCompareYears = [...availableYears].slice(-3);
  }
  if (!selectedCompareYears.includes(selectedYear)) {
    selectedCompareYears.push(selectedYear);
  }
  selectedCompareYears = [...new Set(selectedCompareYears)].sort((a, b) => a - b);

  const yearSeries = [];
  const weatherStorageModes = new Set();

  for (const targetYear of selectedCompareYears) {
    const window = getSeasonWindow(targetYear, today);
    const leadRows = await getDailyLeadRows(window.start, window.end, normalizedSource);
    const leadMap = new Map(leadRows.map((row) => [row.date, row]));

    const weatherInfo = await getPriorityWeatherByDate(
      priorityMarkets,
      window.start,
      window.end,
      weatherApiKey,
    );
    for (const storage of weatherInfo.storageModes) {
      weatherStorageModes.add(storage);
    }

    const points = enumerateDates(window.start, window.end).map((date) => {
      const lead = leadMap.get(date) || null;
      const weather = weatherInfo.byDate.get(date) || null;
      const totalLeads = lead?.total_leads || 0;
      const directMailLeads = lead?.direct_mail_leads || 0;
      const filteredLeads = lead?.filtered_leads || 0;

      return {
        date,
        dayKey: seasonDayKey(date),
        totalLeads,
        directMailLeads,
        filteredLeads,
        directMailPct: totalLeads ? (directMailLeads / totalLeads) * 100 : 0,
        weather: weather
          ? {
              avgTempMax: weather.avgTempMax,
              avgUv: weather.avgUv,
              avgSnowDepth: weather.avgSnowDepth,
            }
          : null,
      };
    });

    yearSeries.push({
      year: targetYear,
      seasonWindow: window,
      points,
    });
  }

  const selectedSeries =
    yearSeries.find((series) => series.year === selectedYear) || yearSeries[0];
  const daily = selectedSeries?.points || [];

  const totals = daily.reduce(
    (acc, row) => {
      acc.totalLeads += row.totalLeads;
      acc.directMailLeads += row.directMailLeads;
      acc.filteredLeads += row.filteredLeads;
      return acc;
    },
    { totalLeads: 0, directMailLeads: 0, filteredLeads: 0 },
  );
  totals.directMailPct = totals.totalLeads
    ? (totals.directMailLeads / totals.totalLeads) * 100
    : 0;
  totals.filteredLeadPct = totals.totalLeads
    ? (totals.filteredLeads / totals.totalLeads) * 100
    : 0;

  return {
    availableYears,
    selectedYear,
    selectedCompareYears,
    sourceFilter: normalizedSource,
    sourceOptions,
    seasonWindow: selectedSeries?.seasonWindow || selectedWindow,
    totals,
    topSources,
    priorityMarkets,
    daily,
    yearSeries,
    weatherImpact: buildWeatherImpact(daily),
    weatherStorage: [...weatherStorageModes],
  };
}
