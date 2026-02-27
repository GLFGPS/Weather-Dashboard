import { NextResponse } from "next/server";
import { loadMarketsConfig } from "../../../../lib/markets";
import { dbQuery, hasDatabaseConnection } from "../../../../lib/db";
import { syncLeadFilesToDb } from "../../../../lib/leads-cache";
import {
  formatISODate,
  getOrFetchWeatherRange,
  shiftDays,
} from "../../../../lib/weather-cache";

export const runtime = "nodejs";

const PRIORITY_MARKET_KEYWORDS = [
  "west chester",
  "north wales",
  "hillsborough",
  "lindenwold",
];
const DEFAULT_START_MM_DD = "02-15";
const DEFAULT_END_MM_DD = "05-10";
const ALLOWED_FORECAST_WINDOWS = new Set([0, 3, 7, 15]);

function marketText(market) {
  return `${market?.name || ""} ${market?.label || ""}`.toLowerCase();
}

function isPriorityMarket(market) {
  const haystack = marketText(market);
  return PRIORITY_MARKET_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function pickPriorityMarkets(markets) {
  const picked = markets.filter((market) => isPriorityMarket(market));
  if (picked.length) return picked;
  return markets.slice(0, 4);
}

function parseMonthDay(value, fallback) {
  const raw = String(value || "").trim() || fallback;
  const match = raw.match(/^(\d{2})-(\d{2})$/);
  if (!match) return fallback;
  return raw;
}

function seasonWindowForYear(year, todayISO, startMonthDay, endMonthDay) {
  const start = `${year}-${startMonthDay}`;
  const plannedEnd = `${year}-${endMonthDay}`;
  const currentYear = Number(todayISO.slice(0, 4));
  if (year > currentYear) return null;
  const end = year === currentYear && todayISO < plannedEnd ? todayISO : plannedEnd;
  if (end < start) return null;
  return { year, startDate: start, endDate: end };
}

function parseRequestedYears(input) {
  if (!Array.isArray(input)) return null;
  const parsed = input
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value));
  return parsed.length ? [...new Set(parsed)].sort((a, b) => a - b) : null;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const limit = Math.max(1, concurrency);
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function getLeadYears() {
  const yearsResult = await dbQuery(`
    SELECT DISTINCT EXTRACT(YEAR FROM lead_date)::int AS year
    FROM leads_daily_source
    ORDER BY year;
  `);
  return yearsResult.rows.map((row) => row.year).filter((value) => Number.isFinite(value));
}

export async function POST(request) {
  try {
    const apiKey = process.env.VISUAL_CROSSING_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "VISUAL_CROSSING_API_KEY is not configured. Add it in Vercel project environment variables.",
        },
        { status: 500 },
      );
    }

    if (!hasDatabaseConnection()) {
      return NextResponse.json(
        {
          error:
            "Database connection is missing. Set POSTGRES_URL or DATABASE_URL before running backfill.",
        },
        { status: 500 },
      );
    }

    let payload = {};
    try {
      payload = await request.json();
    } catch {
      payload = {};
    }

    const startMonthDay = parseMonthDay(payload.startMonthDay, DEFAULT_START_MM_DD);
    const endMonthDay = parseMonthDay(payload.endMonthDay, DEFAULT_END_MM_DD);
    const requestedYears = parseRequestedYears(payload.years);
    const forecastDaysRaw = Number.parseInt(String(payload.forecastDays ?? "15"), 10);
    const forecastDays = ALLOWED_FORECAST_WINDOWS.has(forecastDaysRaw) ? forecastDaysRaw : 15;
    const concurrencyRaw = Number.parseInt(String(payload.concurrency ?? "1"), 10);
    const concurrency = Math.max(1, Math.min(2, Number.isFinite(concurrencyRaw) ? concurrencyRaw : 1));

    const syncReport = await syncLeadFilesToDb();
    const availableYears = await getLeadYears();
    const filteredYears = requestedYears
      ? availableYears.filter((year) => requestedYears.includes(year))
      : availableYears;

    const marketsConfig = await loadMarketsConfig();
    const allMarkets = Array.isArray(marketsConfig.markets) ? marketsConfig.markets : [];
    if (!allMarkets.length) {
      return NextResponse.json(
        { error: "No markets found in market configuration." },
        { status: 400 },
      );
    }
    const priorityMarkets = pickPriorityMarkets(allMarkets);

    const today = new Date();
    const todayISO = formatISODate(today);
    const seasonalWindows = filteredYears
      .map((year) => seasonWindowForYear(year, todayISO, startMonthDay, endMonthDay))
      .filter(Boolean);

    if (!seasonalWindows.length) {
      return NextResponse.json(
        {
          error: "No valid seasonal windows found for the requested years.",
          availableYears,
          requestedYears: requestedYears || null,
        },
        { status: 400 },
      );
    }

    const tasks = [];
    for (const market of priorityMarkets) {
      for (const window of seasonalWindows) {
        tasks.push({
          type: "season",
          marketName: market.name,
          weatherLocation: market.weatherQuery || market.name,
          year: window.year,
          startDate: window.startDate,
          endDate: window.endDate,
        });
      }
    }

    if (forecastDays > 0) {
      const forecastEndDate = formatISODate(shiftDays(today, forecastDays - 1));
      for (const market of priorityMarkets) {
        tasks.push({
          type: "forecast",
          marketName: market.name,
          weatherLocation: market.weatherQuery || market.name,
          year: today.getUTCFullYear(),
          startDate: todayISO,
          endDate: forecastEndDate,
        });
      }
    }

    const startedAt = new Date().toISOString();
    const taskResults = await mapWithConcurrency(tasks, concurrency, async (task) => {
      try {
        const response = await getOrFetchWeatherRange({
          marketName: task.weatherLocation,
          startDate: task.startDate,
          endDate: task.endDate,
          apiKey,
        });
        return {
          ok: true,
          ...task,
          storage: response.storage,
          daysReturned: (response.days || []).length,
        };
      } catch (error) {
        return {
          ok: false,
          ...task,
          error: error.message || "Backfill failed.",
        };
      }
    });

    const success = taskResults.filter((row) => row.ok);
    const failed = taskResults.filter((row) => !row.ok);
    const storageModes = [...new Set(success.map((row) => row.storage))];

    return NextResponse.json({
      startedAt,
      finishedAt: new Date().toISOString(),
      syncReport,
      requested: {
        years: requestedYears,
        seasonStart: startMonthDay,
        seasonEnd: endMonthDay,
        forecastDays,
        concurrency,
      },
      availableYears,
      processedYears: seasonalWindows.map((row) => row.year),
      priorityMarkets: priorityMarkets.map((market) => market.name),
      totalTasks: taskResults.length,
      successfulTasks: success.length,
      failedTasks: failed.length,
      storageModes,
      failed: failed.slice(0, 20),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Weather backfill failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
