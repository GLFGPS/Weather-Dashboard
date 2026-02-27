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
const SEASON_START_MM_DD = "02-15";
const SEASON_END_MM_DD = "05-10";
const SEASON_START_DAY_KEY = 215;
const SEASON_END_DAY_KEY = 510;
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
  return md >= SEASON_START_DAY_KEY && md <= SEASON_END_DAY_KEY;
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

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
  const start = `${year}-${SEASON_START_MM_DD}`;
  const endPlanned = `${year}-${SEASON_END_MM_DD}`;
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

async function getPriorityWeatherByDate(
  priorityMarketNames,
  startDate,
  endDate,
  weatherApiKey,
  options = {},
) {
  const { includeByMarket = false } = options;
  if (!weatherApiKey || !priorityMarketNames.length) {
    return {
      byDate: new Map(),
      byMarket: includeByMarket ? new Map() : null,
      storageModes: ["not-requested"],
    };
  }

  const aggregate = new Map();
  const byMarket = includeByMarket ? new Map() : null;
  const storageModes = new Set();

  for (const marketName of priorityMarketNames) {
    const weatherRange = await getOrFetchWeatherRange({
      marketName,
      startDate,
      endDate,
      apiKey: weatherApiKey,
    });
    storageModes.add(weatherRange.storage);
    const marketDays = includeByMarket ? new Map() : null;

    for (const day of weatherRange.days || []) {
      const tempmax = toFiniteNumber(day.tempmax);
      const uv = toFiniteNumber(day.uvindex);
      const snowDepth = toFiniteNumber(day.snowdepth);
      const precip = toFiniteNumber(day.precip);

      if (marketDays) {
        marketDays.set(day.datetime, {
          avgTempMax: tempmax,
          avgUv: uv,
          avgSnowDepth: snowDepth,
          avgPrecip: precip,
        });
      }

      const entry =
        aggregate.get(day.datetime) || {
          tempmaxSum: 0,
          tempmaxCount: 0,
          uvSum: 0,
          uvCount: 0,
          snowDepthSum: 0,
          snowDepthCount: 0,
          precipSum: 0,
          precipCount: 0,
        };

      if (tempmax !== null) {
        entry.tempmaxSum += tempmax;
        entry.tempmaxCount += 1;
      }
      if (uv !== null) {
        entry.uvSum += uv;
        entry.uvCount += 1;
      }
      if (snowDepth !== null) {
        entry.snowDepthSum += snowDepth;
        entry.snowDepthCount += 1;
      }
      if (precip !== null) {
        entry.precipSum += precip;
        entry.precipCount += 1;
      }
      aggregate.set(day.datetime, entry);
    }

    if (byMarket && marketDays) {
      byMarket.set(marketName, marketDays);
    }
  }

  const byDate = new Map();
  for (const [date, entry] of aggregate.entries()) {
    byDate.set(date, {
      avgTempMax: entry.tempmaxCount ? entry.tempmaxSum / entry.tempmaxCount : null,
      avgUv: entry.uvCount ? entry.uvSum / entry.uvCount : null,
      avgSnowDepth: entry.snowDepthCount ? entry.snowDepthSum / entry.snowDepthCount : null,
      avgPrecip: entry.precipCount ? entry.precipSum / entry.precipCount : null,
    });
  }

  return {
    byDate,
    byMarket,
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

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentage(numerator, denominator) {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

function buildConditionPerformanceMatrix(rows) {
  const tempBands = [
    { key: "cold", label: "Cold (<45°F)", rank: 0, test: (value) => value < 45 },
    {
      key: "mild",
      label: "Mild (45-59°F)",
      rank: 1,
      test: (value) => value >= 45 && value < 60,
    },
    { key: "warm", label: "Warm (>=60°F)", rank: 2, test: (value) => value >= 60 },
  ];
  const snowBands = [
    { key: "snow", label: "Snow on Ground (>0 in)", rank: 0, test: (value) => value > 0 },
    { key: "clear", label: "No Snow (0 in)", rank: 1, test: (value) => value <= 0 },
  ];

  const buckets = new Map();
  for (const tempBand of tempBands) {
    for (const snowBand of snowBands) {
      const key = `${tempBand.key}_${snowBand.key}`;
      buckets.set(key, {
        key,
        rank: tempBand.rank * 10 + snowBand.rank,
        label: `${tempBand.label} + ${snowBand.label}`,
        days: 0,
        filteredLeadSum: 0,
        totalLeadSum: 0,
        directMailLeadSum: 0,
        tempSum: 0,
        uvSum: 0,
        uvCount: 0,
        snowDepthSum: 0,
        precipSum: 0,
      });
    }
  }

  for (const row of rows) {
    const temp = toFiniteNumber(row.weather?.avgTempMax);
    const snowDepth = toFiniteNumber(row.weather?.avgSnowDepth);
    if (temp === null || snowDepth === null) continue;

    const tempBand = tempBands.find((band) => band.test(temp));
    const snowBand = snowBands.find((band) => band.test(snowDepth));
    if (!tempBand || !snowBand) continue;

    const key = `${tempBand.key}_${snowBand.key}`;
    const entry = buckets.get(key);
    if (!entry) continue;

    const filteredLeads = toFiniteNumber(row.filteredLeads) ?? 0;
    const totalLeads = toFiniteNumber(row.totalLeads) ?? 0;
    const directMailLeads = toFiniteNumber(row.directMailLeads) ?? 0;
    const uv = toFiniteNumber(row.weather?.avgUv);
    const precip = toFiniteNumber(row.weather?.avgPrecip) ?? 0;

    entry.days += 1;
    entry.filteredLeadSum += filteredLeads;
    entry.totalLeadSum += totalLeads;
    entry.directMailLeadSum += directMailLeads;
    entry.tempSum += temp;
    entry.snowDepthSum += snowDepth;
    entry.precipSum += precip;
    if (uv !== null) {
      entry.uvSum += uv;
      entry.uvCount += 1;
    }
  }

  return [...buckets.values()]
    .filter((row) => row.days > 0)
    .sort((a, b) => a.rank - b.rank)
    .map((row) => ({
      key: row.key,
      label: row.label,
      days: row.days,
      avgFilteredLeads: row.filteredLeadSum / row.days,
      avgTotalLeads: row.totalLeadSum / row.days,
      avgDirectMailLeads: row.directMailLeadSum / row.days,
      directMailShare: percentage(row.directMailLeadSum, row.totalLeadSum),
      selectedSourceShare: percentage(row.filteredLeadSum, row.totalLeadSum),
      avgTempMax: row.tempSum / row.days,
      avgUv: row.uvCount ? row.uvSum / row.uvCount : null,
      avgSnowDepth: row.snowDepthSum / row.days,
      avgPrecip: row.precipSum / row.days,
    }));
}

function pearsonCorrelation(pairs) {
  if (pairs.length < 2) return null;
  const xs = pairs.map((pair) => pair[0]);
  const ys = pairs.map((pair) => pair[1]);
  const xMean = average(xs);
  const yMean = average(ys);
  if (xMean === null || yMean === null) return null;

  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (const [x, y] of pairs) {
    const xDiff = x - xMean;
    const yDiff = y - yMean;
    numerator += xDiff * yDiff;
    xVariance += xDiff ** 2;
    yVariance += yDiff ** 2;
  }

  if (!xVariance || !yVariance) return null;
  return numerator / Math.sqrt(xVariance * yVariance);
}

function linearSlope(pairs) {
  if (pairs.length < 2) return null;
  const xs = pairs.map((pair) => pair[0]);
  const ys = pairs.map((pair) => pair[1]);
  const xMean = average(xs);
  const yMean = average(ys);
  if (xMean === null || yMean === null) return null;

  let numerator = 0;
  let denominator = 0;
  for (const [x, y] of pairs) {
    const xDiff = x - xMean;
    numerator += xDiff * (y - yMean);
    denominator += xDiff ** 2;
  }

  if (!denominator) return null;
  return numerator / denominator;
}

function buildLagEffect(rows, maxLag = 7) {
  const metrics = [
    { key: "avgTempMax", label: "Avg Temp Max" },
    { key: "avgUv", label: "Avg UV" },
    { key: "avgSnowDepth", label: "Avg Snow Depth" },
  ];

  const lags = [];
  for (let lag = 0; lag <= maxLag; lag += 1) {
    const lagRow = { lag };
    for (const metric of metrics) {
      const pairs = [];
      for (let index = lag; index < rows.length; index += 1) {
        const leadValue = toFiniteNumber(rows[index].filteredLeads);
        const weatherValue = toFiniteNumber(rows[index - lag].weather?.[metric.key]);
        if (leadValue === null || weatherValue === null) continue;
        pairs.push([weatherValue, leadValue]);
      }

      lagRow[metric.key] = {
        correlation: pearsonCorrelation(pairs),
        slope: linearSlope(pairs),
        sampleSize: pairs.length,
      };
    }
    lags.push(lagRow);
  }

  const bestByMetric = {};
  for (const metric of metrics) {
    const ranked = lags
      .map((row) => ({
        lag: row.lag,
        ...row[metric.key],
      }))
      .filter((row) => row.sampleSize >= 5 && row.correlation !== null)
      .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
    bestByMetric[metric.key] = ranked[0] || null;
  }

  return { metrics, lags, bestByMetric };
}

function solveLinearSystem(matrix, vector) {
  const size = matrix.length;
  const a = matrix.map((row) => [...row]);
  const b = [...vector];

  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) {
        pivot = row;
      }
    }

    if (Math.abs(a[pivot][col]) < 1e-9) {
      return null;
    }

    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }

    const pivotValue = a[col][col];
    for (let k = col; k < size; k += 1) {
      a[col][k] /= pivotValue;
    }
    b[col] /= pivotValue;

    for (let row = 0; row < size; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let k = col; k < size; k += 1) {
        a[row][k] -= factor * a[col][k];
      }
      b[row] -= factor * b[col];
    }
  }

  return b;
}

function buildWeatherNormalizedGoalTracking(rows) {
  const featureKeys = ["avgTempMax", "avgUv", "avgSnowDepth", "avgPrecip"];
  const training = [];

  for (const row of rows) {
    const leads = toFiniteNumber(row.filteredLeads);
    const features = featureKeys.map((key) => toFiniteNumber(row.weather?.[key]));
    if (leads === null || features.some((value) => value === null)) continue;
    training.push({ leads, features });
  }

  const emptyPoints = rows.map((row) => ({
    date: row.date,
    dayKey: row.dayKey,
    actualLeads: toFiniteNumber(row.filteredLeads) ?? 0,
    expectedLeads: null,
    lowerBand: null,
    upperBand: null,
    variance: null,
  }));

  if (training.length < 10) {
    return {
      features: featureKeys,
      coefficients: null,
      mae: null,
      rmse: null,
      rSquared: null,
      points: emptyPoints,
    };
  }

  const width = featureKeys.length + 1;
  const xtx = Array.from({ length: width }, () => Array(width).fill(0));
  const xty = Array(width).fill(0);

  for (const row of training) {
    const vector = [1, ...row.features];
    for (let i = 0; i < width; i += 1) {
      xty[i] += vector[i] * row.leads;
      for (let j = 0; j < width; j += 1) {
        xtx[i][j] += vector[i] * vector[j];
      }
    }
  }

  const solved = solveLinearSystem(xtx, xty);
  if (!solved) {
    return {
      features: featureKeys,
      coefficients: null,
      mae: null,
      rmse: null,
      rSquared: null,
      points: emptyPoints,
    };
  }

  const points = rows.map((row) => {
    const actualLeads = toFiniteNumber(row.filteredLeads) ?? 0;
    const features = featureKeys.map((key) => toFiniteNumber(row.weather?.[key]));
    const canPredict = !features.some((value) => value === null);
    const expectedLeads = canPredict
      ? [1, ...features].reduce((sum, value, index) => sum + value * solved[index], 0)
      : null;

    return {
      date: row.date,
      dayKey: row.dayKey,
      actualLeads,
      expectedLeads,
      lowerBand: null,
      upperBand: null,
      variance: expectedLeads === null ? null : actualLeads - expectedLeads,
    };
  });

  const modeled = points.filter((point) => point.expectedLeads !== null);
  const absErrors = modeled.map((point) => Math.abs(point.variance));
  const squaredErrors = modeled.map((point) => point.variance ** 2);
  const mae = average(absErrors);
  const rmse = squaredErrors.length ? Math.sqrt(average(squaredErrors)) : null;
  const meanActual = average(modeled.map((point) => point.actualLeads));
  const totalVariance =
    meanActual === null
      ? 0
      : modeled.reduce((sum, point) => sum + (point.actualLeads - meanActual) ** 2, 0);
  const rSquared =
    totalVariance > 0 && squaredErrors.length
      ? 1 - squaredErrors.reduce((sum, value) => sum + value, 0) / totalVariance
      : null;

  const band = mae === null ? null : Math.max(2, mae);
  for (const point of points) {
    if (point.expectedLeads === null || band === null) continue;
    point.lowerBand = Math.max(0, point.expectedLeads - band);
    point.upperBand = point.expectedLeads + band;
  }

  return {
    features: featureKeys,
    coefficients: {
      intercept: solved[0],
      avgTempMax: solved[1],
      avgUv: solved[2],
      avgSnowDepth: solved[3],
      avgPrecip: solved[4],
    },
    mae,
    rmse,
    rSquared,
    points,
  };
}

function buildDecisionState({ tempMax, snowDepth, precip, leadDelta }) {
  let score = 0;
  const reasons = [];

  if (snowDepth !== null && snowDepth >= 1) {
    score += 3;
    reasons.push("Deep snow on ground");
  } else if (snowDepth !== null && snowDepth > 0) {
    score += 2;
    reasons.push("Snow still on ground");
  }

  if (tempMax !== null && tempMax < 42) {
    score += 1;
    reasons.push("Cold max temperature");
  }

  if (precip !== null && precip >= 0.2) {
    score += 1;
    reasons.push("Wet conditions");
  }

  if (leadDelta !== null && leadDelta <= -10) {
    score += 2;
    reasons.push("Leads trailing weather-adjusted baseline");
  } else if (leadDelta !== null && leadDelta >= 10) {
    score -= 1;
    reasons.push("Leads outperforming weather-adjusted baseline");
  }

  let state = "Go";
  let action = "Proceed with standard outreach and staffing cadence.";
  if (score >= 5) {
    state = "Hold";
    action = "Pause broad outreach. Focus on high-intent follow-up and weather recovery timing.";
  } else if (score >= 3) {
    state = "Caution";
    action = "Use segmented targeting and watch next-day response before scaling spend.";
  }

  return {
    state,
    score,
    reasons: reasons.length ? reasons : ["Conditions supportive for standard plans."],
    action,
  };
}

function buildDecisionByDate(rows, goalTracking) {
  const expectedByDate = new Map(
    (goalTracking?.points || []).map((point) => [point.date, point.expectedLeads]),
  );

  return rows
    .map((row) => {
      const tempMax = toFiniteNumber(row.weather?.avgTempMax);
      const snowDepth = toFiniteNumber(row.weather?.avgSnowDepth);
      const precip = toFiniteNumber(row.weather?.avgPrecip);
      const actualLeads = toFiniteNumber(row.filteredLeads);
      const expectedLeads = toFiniteNumber(expectedByDate.get(row.date));
      const leadDelta =
        actualLeads !== null && expectedLeads !== null ? actualLeads - expectedLeads : null;

      const decision = buildDecisionState({
        tempMax,
        snowDepth,
        precip,
        leadDelta,
      });

      return {
        date: row.date,
        actualLeads,
        expectedLeads,
        leadDelta,
        tempMax,
        snowDepth,
        precip,
        ...decision,
      };
    })
    .filter((row) => row.tempMax !== null || row.snowDepth !== null || row.precip !== null);
}

function buildMarketWeatherElasticity(rows, byMarketWeatherDate) {
  if (!byMarketWeatherDate || !byMarketWeatherDate.size) return [];

  const output = [];
  for (const [marketName, marketDays] of byMarketWeatherDate.entries()) {
    const tempPairs = [];
    const snowPairs = [];
    const precipPairs = [];

    for (const row of rows) {
      const leadValue = toFiniteNumber(row.filteredLeads);
      const day = marketDays.get(row.date);
      if (leadValue === null || !day) continue;

      const tempValue = toFiniteNumber(day.avgTempMax);
      const snowValue = toFiniteNumber(day.avgSnowDepth);
      const precipValue = toFiniteNumber(day.avgPrecip);

      if (tempValue !== null) tempPairs.push([tempValue, leadValue]);
      if (snowValue !== null) snowPairs.push([snowValue, leadValue]);
      if (precipValue !== null) precipPairs.push([precipValue, leadValue]);
    }

    const tempCorrelation = pearsonCorrelation(tempPairs);
    const snowCorrelation = pearsonCorrelation(snowPairs);
    const precipCorrelation = pearsonCorrelation(precipPairs);
    const tempSlope = linearSlope(tempPairs);
    const snowSlope = linearSlope(snowPairs);
    const precipSlope = linearSlope(precipPairs);

    const elasticityScore =
      100 *
      (Math.abs(tempCorrelation || 0) * 0.45 +
        Math.abs(snowCorrelation || 0) * 0.35 +
        Math.abs(precipCorrelation || 0) * 0.2);

    const directionalTilt = (tempCorrelation || 0) - (snowCorrelation || 0) - (precipCorrelation || 0);
    let profile = "Mixed sensitivity";
    if (directionalTilt >= 0.25) profile = "Weather tailwind profile";
    if (directionalTilt <= -0.25) profile = "Weather headwind profile";

    output.push({
      marketName,
      elasticityScore,
      sampleSize: Math.max(tempPairs.length, snowPairs.length, precipPairs.length, 0),
      profile,
      temp: {
        correlation: tempCorrelation,
        slope: tempSlope,
        sampleSize: tempPairs.length,
      },
      snowDepth: {
        correlation: snowCorrelation,
        slope: snowSlope,
        sampleSize: snowPairs.length,
      },
      precip: {
        correlation: precipCorrelation,
        slope: precipSlope,
        sampleSize: precipPairs.length,
      },
    });
  }

  return output.sort((a, b) => b.elasticityScore - a.elasticityScore);
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
              avgPrecip: weather.avgPrecip,
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

  const conditionMatrix = buildConditionPerformanceMatrix(daily);
  const lagEffect = buildLagEffect(daily);
  const goalTracking = buildWeatherNormalizedGoalTracking(daily);

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
    insights: {
      conditionMatrix,
      lagEffect,
      goalTracking,
    },
    weatherStorage: [...weatherStorageModes],
  };
}
