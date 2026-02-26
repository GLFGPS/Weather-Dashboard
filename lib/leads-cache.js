import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { parse as parseCsv } from "csv-parse/sync";
import { dbQuery, getDbPool, hasDatabaseConnection } from "./db";
import { getOrFetchWeatherRange } from "./weather-cache";

const LEAD_DATE_COLUMN = "EstimateRequestedDate";
const LEAD_SOURCE_COLUMN = "ProgramSourceDescription";

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

function isDirectMailSource(source) {
  const normalized = String(source || "").toUpperCase();
  return normalized.startsWith("DM") || normalized.includes("DIRECT MAIL");
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

  return report;
}

export async function getLeadOverview({ year, benchmarkMarket, weatherApiKey }) {
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
  const seasonStart = `${selectedYear}-02-15`;
  const seasonEndPlanned = `${selectedYear}-05-17`;
  const isCurrentYear = selectedYear === today.getUTCFullYear();
  const currentDateISO = toISODate(today);
  const seasonEnd =
    isCurrentYear && currentDateISO < seasonEndPlanned ? currentDateISO : seasonEndPlanned;

  const dailyResult = await dbQuery(
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
        )::int AS direct_mail_leads
      FROM leads_daily_source
      WHERE lead_date BETWEEN $1::date AND $2::date
      GROUP BY lead_date
      ORDER BY lead_date;
    `,
    [seasonStart, seasonEnd],
  );

  const sourceResult = await dbQuery(
    `
      SELECT
        lead_source AS source,
        SUM(lead_count)::int AS count
      FROM leads_daily_source
      WHERE lead_date BETWEEN $1::date AND $2::date
      GROUP BY lead_source
      ORDER BY count DESC, source ASC
      LIMIT 20;
    `,
    [seasonStart, seasonEnd],
  );

  const totals = dailyResult.rows.reduce(
    (acc, row) => {
      acc.totalLeads += row.total_leads;
      acc.directMailLeads += row.direct_mail_leads;
      return acc;
    },
    { totalLeads: 0, directMailLeads: 0 },
  );
  totals.directMailPct = totals.totalLeads
    ? (totals.directMailLeads / totals.totalLeads) * 100
    : 0;

  let weatherMap = new Map();
  let weatherStorage = "not-requested";
  if (weatherApiKey) {
    const weatherRange = await getOrFetchWeatherRange({
      marketName: benchmarkMarket,
      startDate: seasonStart,
      endDate: seasonEnd,
      apiKey: weatherApiKey,
    });
    weatherStorage = weatherRange.storage;
    weatherMap = new Map(
      (weatherRange.days || []).map((day) => [day.datetime, day]),
    );
  }

  const daily = dailyResult.rows.map((row) => {
    const weather = weatherMap.get(row.date) || null;
    return {
      date: row.date,
      totalLeads: row.total_leads,
      directMailLeads: row.direct_mail_leads,
      directMailPct: row.total_leads
        ? (row.direct_mail_leads / row.total_leads) * 100
        : 0,
      weather: weather
        ? {
            tempmax: weather.tempmax,
            tempmin: weather.tempmin,
            uvindex: weather.uvindex,
            precip: weather.precip,
            snow: weather.snow,
            snowdepth: weather.snowdepth,
            conditions: weather.conditions,
          }
        : null,
    };
  });

  const snowDays = daily.filter(
    (row) => (row.weather?.snow ?? 0) > 0 || (row.weather?.snowdepth ?? 0) > 0,
  );
  const clearDays = daily.filter(
    (row) => (row.weather?.snow ?? 0) <= 0 && (row.weather?.snowdepth ?? 0) <= 0,
  );

  const avg = (rows, key) =>
    rows.length
      ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length
      : null;

  const coldDays = daily.filter((row) => (row.weather?.tempmax ?? 999) < 45);
  const warmDays = daily.filter((row) => (row.weather?.tempmax ?? -999) >= 55);

  return {
    availableYears,
    selectedYear,
    seasonWindow: {
      start: seasonStart,
      end: seasonEnd,
    },
    totals,
    topSources: sourceResult.rows,
    daily,
    weatherImpact: {
      avgLeadsSnowDays: avg(snowDays, "totalLeads"),
      avgLeadsClearDays: avg(clearDays, "totalLeads"),
      avgLeadsColdDays: avg(coldDays, "totalLeads"),
      avgLeadsWarmDays: avg(warmDays, "totalLeads"),
      sampleSize: {
        snowDays: snowDays.length,
        clearDays: clearDays.length,
        coldDays: coldDays.length,
        warmDays: warmDays.length,
      },
    },
    weatherStorage,
  };
}
