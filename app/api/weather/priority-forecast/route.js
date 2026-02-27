import { NextResponse } from "next/server";
import { loadMarketsConfig } from "../../../../lib/markets";
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
const FORECAST_WINDOWS = new Set([3, 7, 15]);

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

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDayLabel(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

export async function GET(request) {
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

    const { searchParams } = new URL(request.url);
    const requestedDays = Number.parseInt(searchParams.get("days") || "15", 10);
    const days = FORECAST_WINDOWS.has(requestedDays) ? requestedDays : 15;

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
    const startISO = formatISODate(today);
    const endISO = formatISODate(shiftDays(today, days - 1));

    const rows = await mapWithConcurrency(priorityMarkets, 1, async (market) => {
      try {
        const response = await getOrFetchWeatherRange({
          marketName: market.name,
          startDate: startISO,
          endDate: endISO,
          apiKey,
        });
        return {
          ok: true,
          marketName: market.name,
          storage: response.storage,
          days: response.days || [],
        };
      } catch (error) {
        return {
          ok: false,
          marketName: market.name,
          error: error.message || "Forecast fetch failed.",
        };
      }
    });

    const errors = rows
      .filter((row) => !row.ok)
      .map((row) => ({
        market: row.marketName,
        error: row.error,
      }));
    const successfulRows = rows.filter((row) => row.ok);
    if (!successfulRows.length) {
      return NextResponse.json(
        {
          error:
            "Unable to load forecast for priority markets. Check location formatting and API quota.",
          errors,
        },
        { status: 502 },
      );
    }

    const aggregate = new Map();
    for (const row of successfulRows) {
      for (const day of row.days || []) {
        const entry = aggregate.get(day.datetime) || {
          tempMaxSum: 0,
          tempMaxCount: 0,
          tempMinSum: 0,
          tempMinCount: 0,
          uvSum: 0,
          uvCount: 0,
          precipProbSum: 0,
          precipProbCount: 0,
          snowDepthSum: 0,
          snowDepthCount: 0,
        };

        const tempMax = toNumber(day.tempmax);
        const tempMin = toNumber(day.tempmin);
        const uv = toNumber(day.uvindex);
        const precipProb = toNumber(day.precipprob);
        const snowDepth = toNumber(day.snowdepth);

        if (tempMax !== null) {
          entry.tempMaxSum += tempMax;
          entry.tempMaxCount += 1;
        }
        if (tempMin !== null) {
          entry.tempMinSum += tempMin;
          entry.tempMinCount += 1;
        }
        if (uv !== null) {
          entry.uvSum += uv;
          entry.uvCount += 1;
        }
        if (precipProb !== null) {
          entry.precipProbSum += precipProb;
          entry.precipProbCount += 1;
        }
        if (snowDepth !== null) {
          entry.snowDepthSum += snowDepth;
          entry.snowDepthCount += 1;
        }

        aggregate.set(day.datetime, entry);
      }
    }

    const forecast = [];
    for (let offset = 0; offset < days; offset += 1) {
      const date = formatISODate(shiftDays(today, offset));
      const entry = aggregate.get(date) || null;
      forecast.push({
        date,
        dayLabel: formatDayLabel(date),
        avgTempMax: entry?.tempMaxCount ? entry.tempMaxSum / entry.tempMaxCount : null,
        avgTempMin: entry?.tempMinCount ? entry.tempMinSum / entry.tempMinCount : null,
        avgUv: entry?.uvCount ? entry.uvSum / entry.uvCount : null,
        avgPrecipProb: entry?.precipProbCount
          ? entry.precipProbSum / entry.precipProbCount
          : null,
        avgSnowDepth: entry?.snowDepthCount ? entry.snowDepthSum / entry.snowDepthCount : null,
      });
    }

    const storageModes = [...new Set(successfulRows.map((row) => row.storage))];

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      days,
      startDate: startISO,
      endDate: endISO,
      priorityMarkets: priorityMarkets.map((market) => market.name),
      storageModes,
      forecast,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Priority forecast endpoint failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
