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

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function marketText(market) {
  return `${market?.name || ""} ${market?.label || ""}`.toLowerCase();
}

function isPriorityMarket(market) {
  const haystack = marketText(market);
  return PRIORITY_MARKET_KEYWORDS.some((needle) => haystack.includes(needle));
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

function classifyHeadwind(today, lookback, forecast) {
  let score = 0;

  if ((today?.snow ?? 0) > 0) score += 2;
  if ((today?.snowdepth ?? 0) >= 0.5) score += 3;
  if ((lookback?.snowDays ?? 0) >= 3) score += 2;
  if ((lookback?.maxSnowDepth ?? 0) >= 0.75) score += 2;
  if ((today?.tempmax ?? 99) < 42) score += 1;
  if ((lookback?.precipRate ?? 0) > 0.45) score += 1;

  const freezingForecastNights = (forecast || []).filter(
    (day) => (day?.tempmin ?? 99) <= 30,
  ).length;
  if (freezingForecastNights >= 2) score += 1;

  let level = "low";
  let signal = "Conditions are generally favorable for normal direct-mail cadence.";
  if (score >= 6) {
    level = "high";
    signal =
      "Hold or trim heavy direct-mail drops. Snow and cold headwinds can reduce near-term response intent.";
  } else if (score >= 3) {
    level = "medium";
    signal =
      "Use caution. Keep direct-mail active but prioritize higher-intent segments and stagger volume.";
  }

  return {
    headwindLevel: level,
    headwindScore: score,
    directMailSignal: signal,
  };
}

function buildMarketSummary(market, resolvedAddress, days, todayISO, requestedLookbackDays) {
  const today =
    days.find((day) => day.datetime === todayISO) || days[days.length - 1] || null;
  if (!today) {
    return null;
  }

  const lookbackDays = days.filter((day) => day.datetime <= todayISO);
  const forecast = days.filter((day) => day.datetime > todayISO).slice(0, 3);

  const highs = lookbackDays
    .map((day) => day.tempmax)
    .filter((value) => value !== null && value !== undefined);
  const lows = lookbackDays
    .map((day) => day.tempmin)
    .filter((value) => value !== null && value !== undefined);
  const snowValues = lookbackDays.map((day) => day.snow ?? 0);
  const snowDepthValues = lookbackDays.map((day) => day.snowdepth ?? 0);
  const precipDays = lookbackDays.filter((day) => (day.precip ?? 0) > 0).length;

  const lookback = {
    requestedDays: requestedLookbackDays,
    returnedDays: lookbackDays.length,
    avgHigh: mean(highs),
    avgLow: mean(lows),
    snowDays: lookbackDays.filter(
      (day) => (day.snow ?? 0) > 0 || (day.snowdepth ?? 0) > 0,
    ).length,
    totalSnow: snowValues.reduce((sum, value) => sum + value, 0),
    maxSnowDepth: snowDepthValues.length ? Math.max(...snowDepthValues) : 0,
    precipDays,
    precipRate: lookbackDays.length ? precipDays / lookbackDays.length : 0,
  };

  const headwind = classifyHeadwind(today, lookback, forecast);

  return {
    ...market,
    location: resolvedAddress || market.name,
    today: {
      datetime: today.datetime,
      temp: toNumber(today.temp),
      tempmax: toNumber(today.tempmax),
      tempmin: toNumber(today.tempmin),
      humidity: toNumber(today.humidity),
      precip: toNumber(today.precip) ?? 0,
      precipprob: toNumber(today.precipprob),
      snow: toNumber(today.snow) ?? 0,
      snowdepth: toNumber(today.snowdepth) ?? 0,
      conditions: today.conditions || null,
    },
    lookback,
    forecast: forecast.map((day) => ({
      datetime: day.datetime,
      temp: toNumber(day.temp),
      tempmax: toNumber(day.tempmax),
      tempmin: toNumber(day.tempmin),
      humidity: toNumber(day.humidity),
      precip: toNumber(day.precip) ?? 0,
      precipprob: toNumber(day.precipprob),
      snow: toNumber(day.snow) ?? 0,
      snowdepth: toNumber(day.snowdepth) ?? 0,
      conditions: day.conditions || null,
    })),
    ...headwind,
  };
}

function buildOverview(markets) {
  return {
    totalMarkets: markets.length,
    highHeadwinds: markets.filter((market) => market.headwindLevel === "high").length,
    mediumHeadwinds: markets.filter((market) => market.headwindLevel === "medium").length,
    lowHeadwinds: markets.filter((market) => market.headwindLevel === "low").length,
    avgTodayTemp: mean(
      markets
        .map((market) => market.today?.temp)
        .filter((value) => value !== null && value !== undefined),
    ),
    avgSnowDepth: mean(
      markets
        .map((market) => market.today?.snowdepth ?? 0)
        .filter((value) => value !== null && value !== undefined),
    ),
  };
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
    const mode = (searchParams.get("mode") || "priority").toLowerCase();
    const requestedLookbackRaw = Number.parseInt(
      searchParams.get("lookbackDays") || "21",
      10,
    );
    const requestedLookbackDays = Number.isFinite(requestedLookbackRaw)
      ? Math.min(120, Math.max(7, requestedLookbackRaw))
      : 21;

    const effectiveLookbackDays = mode === "all" ? 7 : requestedLookbackDays;

    const marketsConfig = await loadMarketsConfig();
    const allMarkets = Array.isArray(marketsConfig.markets) ? marketsConfig.markets : [];
    if (!allMarkets.length) {
      return NextResponse.json(
        { error: "No markets found in market configuration." },
        { status: 400 },
      );
    }

    const priorityMarkets = pickPriorityMarkets(allMarkets);
    const selectedMarkets =
      mode === "all"
        ? allMarkets
        : priorityMarkets;

    const now = new Date();
    const todayISO = formatISODate(now);
    const startDate = formatISODate(shiftDays(now, -(effectiveLookbackDays - 1)));
    const endDate = formatISODate(shiftDays(now, 3));

    const concurrency = mode === "all" ? 1 : 2;

    const taskResults = await mapWithConcurrency(
      selectedMarkets,
      concurrency,
      async (market) => {
        try {
          const result = await getOrFetchWeatherRange({
            marketName: market.name,
            startDate,
            endDate,
            apiKey,
          });

          const summary = buildMarketSummary(
            market,
            result.resolvedAddress,
            result.days,
            todayISO,
            effectiveLookbackDays,
          );

          return {
            ok: true,
            market: summary,
            storage: result.storage,
          };
        } catch (error) {
          return {
            ok: false,
            error: error.message || "Unknown weather fetch failure.",
            marketName: market.name,
          };
        }
      },
    );

    const markets = taskResults
      .filter((entry) => entry.ok && entry.market)
      .map((entry) => entry.market);
    const errors = taskResults
      .filter((entry) => !entry.ok)
      .map((entry) => ({
        market: entry.marketName,
        error: entry.error,
      }));

    if (!markets.length) {
      return NextResponse.json(
        {
          error:
            "Unable to load weather for configured markets. Check location formatting and API quota.",
          errors,
        },
        { status: 502 },
      );
    }

    const storageModes = [...new Set(taskResults.filter((entry) => entry.ok).map((entry) => entry.storage))];

    return NextResponse.json({
      source: marketsConfig.source,
      updatedAt: marketsConfig.updatedAt || null,
      fetchedAt: new Date().toISOString(),
      mode,
      requestedLookbackDays,
      lookbackDays: effectiveLookbackDays,
      priorityMarketNames: priorityMarkets.map((market) => market.name),
      selectedMarketCount: selectedMarkets.length,
      totalConfiguredMarkets: allMarkets.length,
      remainingMarkets: Math.max(allMarkets.length - selectedMarkets.length, 0),
      storageModes,
      overview: buildOverview(markets),
      markets,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Market weather endpoint failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
