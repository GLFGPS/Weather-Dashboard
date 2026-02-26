import { dbQuery, hasDatabaseConnection } from "./db";

const VC_BASE_URL =
  "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline";

let schemaReadyPromise = null;

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function toNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mapVisualCrossingDay(day) {
  if (!day?.datetime) return null;

  return {
    datetime: day.datetime,
    temp: toNullableNumber(day.temp),
    tempmax: toNullableNumber(day.tempmax),
    tempmin: toNullableNumber(day.tempmin),
    humidity: toNullableNumber(day.humidity),
    precip: toNullableNumber(day.precip) ?? 0,
    precipprob: toNullableNumber(day.precipprob),
    snow: toNullableNumber(day.snow) ?? 0,
    snowdepth: toNullableNumber(day.snowdepth) ?? 0,
    conditions: day.conditions || null,
    feelslike: toNullableNumber(day.feelslike),
    windspeed: toNullableNumber(day.windspeed),
    winddir: toNullableNumber(day.winddir),
    sunrise: day.sunrise || null,
    sunset: day.sunset || null,
    uvindex: toNullableNumber(day.uvindex),
  };
}

function normalizeMarketName(marketName) {
  return String(marketName || "").trim();
}

function enumerateDateRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const dates = [];

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(toISODate(cursor));
  }

  return dates;
}

async function ensureWeatherSchema() {
  if (!hasDatabaseConnection()) return;

  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await dbQuery(`
        CREATE TABLE IF NOT EXISTS weather_daily (
          market_name TEXT NOT NULL,
          weather_date DATE NOT NULL,
          resolved_address TEXT,
          temp DOUBLE PRECISION,
          tempmax DOUBLE PRECISION,
          tempmin DOUBLE PRECISION,
          humidity DOUBLE PRECISION,
          precip DOUBLE PRECISION,
          precipprob DOUBLE PRECISION,
          snow DOUBLE PRECISION,
          snowdepth DOUBLE PRECISION,
          conditions TEXT,
          feelslike DOUBLE PRECISION,
          windspeed DOUBLE PRECISION,
          winddir DOUBLE PRECISION,
          sunrise TEXT,
          sunset TEXT,
          uvindex DOUBLE PRECISION,
          fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (market_name, weather_date)
        );
      `);

      await dbQuery(`
        CREATE INDEX IF NOT EXISTS weather_daily_date_idx
        ON weather_daily (weather_date);
      `);
    })();
  }

  await schemaReadyPromise;
}

async function fetchWeatherRowsFromDb(marketName, startDate, endDate) {
  await ensureWeatherSchema();
  if (!hasDatabaseConnection()) return [];

  const market = normalizeMarketName(marketName);
  const result = await dbQuery(
    `
      SELECT
        weather_date::text AS datetime,
        resolved_address,
        temp,
        tempmax,
        tempmin,
        humidity,
        precip,
        precipprob,
        snow,
        snowdepth,
        conditions,
        feelslike,
        windspeed,
        winddir,
        sunrise,
        sunset,
        uvindex
      FROM weather_daily
      WHERE market_name = $1
        AND weather_date BETWEEN $2::date AND $3::date
      ORDER BY weather_date ASC;
    `,
    [market, startDate, endDate],
  );

  return result.rows.map((row) => ({
    datetime: row.datetime,
    temp: row.temp,
    tempmax: row.tempmax,
    tempmin: row.tempmin,
    humidity: row.humidity,
    precip: row.precip ?? 0,
    precipprob: row.precipprob,
    snow: row.snow ?? 0,
    snowdepth: row.snowdepth ?? 0,
    conditions: row.conditions,
    feelslike: row.feelslike,
    windspeed: row.windspeed,
    winddir: row.winddir,
    sunrise: row.sunrise,
    sunset: row.sunset,
    uvindex: row.uvindex,
    resolvedAddress: row.resolved_address,
  }));
}

async function upsertWeatherRows(marketName, resolvedAddress, days) {
  await ensureWeatherSchema();
  if (!hasDatabaseConnection() || !days.length) return;

  const market = normalizeMarketName(marketName);
  const values = [];
  const placeholders = [];

  days.forEach((day, index) => {
    const base = index * 18;
    placeholders.push(
      `($${base + 1}, $${base + 2}::date, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18})`,
    );

    values.push(
      market,
      day.datetime,
      resolvedAddress || null,
      day.temp,
      day.tempmax,
      day.tempmin,
      day.humidity,
      day.precip,
      day.precipprob,
      day.snow,
      day.snowdepth,
      day.conditions,
      day.feelslike,
      day.windspeed,
      day.winddir,
      day.sunrise,
      day.sunset,
      day.uvindex,
    );
  });

  await dbQuery(
    `
      INSERT INTO weather_daily (
        market_name,
        weather_date,
        resolved_address,
        temp,
        tempmax,
        tempmin,
        humidity,
        precip,
        precipprob,
        snow,
        snowdepth,
        conditions,
        feelslike,
        windspeed,
        winddir,
        sunrise,
        sunset,
        uvindex
      )
      VALUES ${placeholders.join(", ")}
      ON CONFLICT (market_name, weather_date)
      DO UPDATE SET
        resolved_address = EXCLUDED.resolved_address,
        temp = EXCLUDED.temp,
        tempmax = EXCLUDED.tempmax,
        tempmin = EXCLUDED.tempmin,
        humidity = EXCLUDED.humidity,
        precip = EXCLUDED.precip,
        precipprob = EXCLUDED.precipprob,
        snow = EXCLUDED.snow,
        snowdepth = EXCLUDED.snowdepth,
        conditions = EXCLUDED.conditions,
        feelslike = EXCLUDED.feelslike,
        windspeed = EXCLUDED.windspeed,
        winddir = EXCLUDED.winddir,
        sunrise = EXCLUDED.sunrise,
        sunset = EXCLUDED.sunset,
        uvindex = EXCLUDED.uvindex,
        updated_at = now();
    `,
    values,
  );
}

async function fetchTimelineFromVisualCrossing(marketName, startDate, endDate, apiKey) {
  const encodedLocation = encodeURIComponent(normalizeMarketName(marketName));
  const url =
    `${VC_BASE_URL}/${encodedLocation}/${startDate}/${endDate}` +
    `?unitGroup=us&include=days` +
    `&elements=datetime,temp,tempmax,tempmin,humidity,precip,precipprob,snow,snowdepth,conditions,feelslike,windspeed,winddir,sunrise,sunset,uvindex` +
    `&key=${apiKey}&contentType=json`;

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Visual Crossing request failed (${response.status}) for ${marketName}: ${text}`,
    );
  }

  const payload = await response.json();
  const days = (payload.days || []).map((day) => mapVisualCrossingDay(day)).filter(Boolean);

  return {
    resolvedAddress: payload.resolvedAddress || normalizeMarketName(marketName),
    days,
  };
}

export async function getOrFetchWeatherRange({
  marketName,
  startDate,
  endDate,
  apiKey,
}) {
  const market = normalizeMarketName(marketName);
  if (!market) {
    throw new Error("marketName is required for weather range fetch.");
  }
  if (!apiKey) {
    throw new Error("VISUAL_CROSSING_API_KEY is required for weather fetch.");
  }

  const requiredDates = enumerateDateRange(startDate, endDate);
  const cachedRows = await fetchWeatherRowsFromDb(market, startDate, endDate);
  const cachedDateSet = new Set(cachedRows.map((row) => row.datetime));
  const hasAllDates = requiredDates.every((date) => cachedDateSet.has(date));

  if (hasAllDates) {
    return {
      marketName: market,
      resolvedAddress:
        cachedRows.find((row) => row.resolvedAddress)?.resolvedAddress || market,
      days: cachedRows,
      storage: hasDatabaseConnection() ? "neon-cache-hit" : "memory-only",
    };
  }

  const fresh = await fetchTimelineFromVisualCrossing(market, startDate, endDate, apiKey);
  await upsertWeatherRows(market, fresh.resolvedAddress, fresh.days);

  const refreshedRows = await fetchWeatherRowsFromDb(market, startDate, endDate);
  const rows = refreshedRows.length ? refreshedRows : fresh.days;

  return {
    marketName: market,
    resolvedAddress: fresh.resolvedAddress || market,
    days: rows,
    storage: hasDatabaseConnection() ? "neon-cache-miss" : "memory-only",
  };
}

export function shiftDays(date, days) {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

export function formatISODate(date) {
  return toISODate(date);
}
