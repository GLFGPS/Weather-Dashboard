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

const ROLLING_DAYS = 7;
const SEASON_END_MONTH_INDEX = 4;
const SEASON_END_DAY = 10;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

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

function parseAnalysisDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function clampToSeasonEnd(date) {
  const seasonEnd = new Date(
    Date.UTC(date.getUTCFullYear(), SEASON_END_MONTH_INDEX, SEASON_END_DAY),
  );
  return date > seasonEnd ? seasonEnd : date;
}

function summarizeWindow(days) {
  const maxTemps = days
    .map((day) => toNumber(day.tempmax))
    .filter((value) => value !== null);
  const minTemps = days
    .map((day) => toNumber(day.tempmin))
    .filter((value) => value !== null);
  const uvs = days.map((day) => toNumber(day.uvindex)).filter((value) => value !== null);
  const snowDepths = days
    .map((day) => toNumber(day.snowdepth) ?? 0)
    .filter((value) => value !== null);
  const precips = days
    .map((day) => toNumber(day.precip) ?? 0)
    .filter((value) => value !== null);
  const humidities = days
    .map((day) => toNumber(day.humidity))
    .filter((value) => value !== null);
  const snowfall = days
    .map((day) => toNumber(day.snow) ?? 0)
    .filter((value) => value !== null);

  return {
    avgMaxTemp: mean(maxTemps),
    avgMinTemp: mean(minTemps),
    avgUv: mean(uvs),
    avgSnowDepth: mean(snowDepths),
    avgPrecip: mean(precips),
    avgHumidity: mean(humidities),
    avgSnowfall: mean(snowfall),
    snowDays: days.filter(
      (day) => (toNumber(day.snow) ?? 0) > 0 || (toNumber(day.snowdepth) ?? 0) > 0,
    ).length,
  };
}

function metricComparison(current, previous) {
  const safeCurrent = current ?? null;
  const safePrevious = previous ?? null;
  const delta =
    safeCurrent !== null && safePrevious !== null
      ? safeCurrent - safePrevious
      : null;
  const deltaPct =
    delta !== null && safePrevious !== 0 ? (delta / Math.abs(safePrevious)) * 100 : null;

  return {
    current: safeCurrent,
    previous: safePrevious,
    delta,
    deltaPct,
  };
}

function compareMetrics(current, previous) {
  return {
    avgMaxTemp: metricComparison(current.avgMaxTemp, previous.avgMaxTemp),
    avgMinTemp: metricComparison(current.avgMinTemp, previous.avgMinTemp),
    avgUv: metricComparison(current.avgUv, previous.avgUv),
    avgSnowDepth: metricComparison(current.avgSnowDepth, previous.avgSnowDepth),
    avgPrecip: metricComparison(current.avgPrecip, previous.avgPrecip),
    avgHumidity: metricComparison(current.avgHumidity, previous.avgHumidity),
    avgSnowfall: metricComparison(current.avgSnowfall, previous.avgSnowfall),
    snowDays: metricComparison(current.snowDays, previous.snowDays),
  };
}

function buildSignal(summary, day) {
  let score = 0;
  if ((day?.snowdepth ?? 0) >= 0.5) score += 3;
  if ((day?.snow ?? 0) > 0) score += 2;
  if ((summary?.avgMaxTemp ?? 99) < 42) score += 1;
  if ((summary?.snowDays ?? 0) >= 3) score += 2;
  if ((summary?.avgPrecip ?? 0) > 0.2) score += 1;

  if (score >= 6) {
    return "Weather headwinds are elevated. Consider lighter direct-mail cadence.";
  }

  if (score >= 3) {
    return "Moderate headwinds. Prioritize high-intent segments and monitor response.";
  }

  return "Weather setup is relatively favorable for normal cadence.";
}

function aggregateOverview(marketRows, analysisDateISO, windowStartISO, prevWindowStartISO, prevAnalysisDateISO) {
  const metricKeys = [
    "avgMaxTemp",
    "avgMinTemp",
    "avgUv",
    "avgSnowDepth",
    "avgPrecip",
    "avgHumidity",
    "avgSnowfall",
    "snowDays",
  ];

  const averagesCurrent = {};
  const averagesPrevious = {};
  for (const key of metricKeys) {
    averagesCurrent[key] = mean(
      marketRows
        .map((row) => row.metrics[key])
        .filter((value) => value !== null && value !== undefined),
    );
    averagesPrevious[key] = mean(
      marketRows
        .map((row) => row.previousMetrics[key])
        .filter((value) => value !== null && value !== undefined),
    );
  }

  return {
    window: {
      analysisDate: analysisDateISO,
      startDate: windowStartISO,
      days: ROLLING_DAYS,
      previousAnalysisDate: prevAnalysisDateISO,
      previousStartDate: prevWindowStartISO,
    },
    yoyCards: compareMetrics(averagesCurrent, averagesPrevious),
    marketCount: marketRows.length,
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
    const includeMarket = searchParams.get("includeMarket")?.trim() || "";
    const requestedDate = parseAnalysisDate(searchParams.get("analysisDate"));
    const today = new Date();
    const analysisDateRaw = requestedDate && requestedDate <= today ? requestedDate : today;
    const analysisDate = clampToSeasonEnd(analysisDateRaw);

    const analysisDateISO = formatISODate(analysisDate);
    const windowStartISO = formatISODate(shiftDays(analysisDate, -(ROLLING_DAYS - 1)));

    const previousDate = new Date(analysisDate);
    previousDate.setUTCFullYear(previousDate.getUTCFullYear() - 1);
    const prevAnalysisDateISO = formatISODate(previousDate);
    const prevWindowStartISO = formatISODate(shiftDays(previousDate, -(ROLLING_DAYS - 1)));

    const marketsConfig = await loadMarketsConfig();
    const allMarkets = Array.isArray(marketsConfig.markets) ? marketsConfig.markets : [];
    if (!allMarkets.length) {
      return NextResponse.json(
        { error: "No markets found in market configuration." },
        { status: 400 },
      );
    }

    const priorityMarkets = pickPriorityMarkets(allMarkets);
    let selectedMarkets = mode === "all" ? allMarkets : priorityMarkets;
    if (includeMarket) {
      const includeRow = allMarkets.find((market) => market.name === includeMarket);
      if (includeRow && !selectedMarkets.some((market) => market.name === includeRow.name)) {
        selectedMarkets = [...selectedMarkets, includeRow];
      }
    }
    const concurrency = mode === "all" ? 1 : 2;

    const rows = await mapWithConcurrency(selectedMarkets, concurrency, async (market) => {
      try {
        const current = await getOrFetchWeatherRange({
          marketName: market.name,
          startDate: windowStartISO,
          endDate: analysisDateISO,
          apiKey,
        });
        const previous = await getOrFetchWeatherRange({
          marketName: market.name,
          startDate: prevWindowStartISO,
          endDate: prevAnalysisDateISO,
          apiKey,
        });

        const day =
          current.days.find((entry) => entry.datetime === analysisDateISO) ||
          current.days[current.days.length - 1] ||
          null;
        const metrics = summarizeWindow(current.days || []);
        const previousMetrics = summarizeWindow(previous.days || []);
        const yoy = compareMetrics(metrics, previousMetrics);

        return {
          ok: true,
          storage: current.storage,
          market: {
            ...market,
            location: current.resolvedAddress || market.name,
            day: day
              ? {
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
                  uvindex: toNumber(day.uvindex),
                }
              : null,
            metrics,
            previousMetrics,
            yoy,
            directMailSignal: buildSignal(metrics, day),
          },
        };
      } catch (error) {
        return {
          ok: false,
          marketName: market.name,
          error: error.message || "Unknown weather fetch failure.",
        };
      }
    });

    const markets = rows.filter((row) => row.ok).map((row) => row.market);
    const errors = rows
      .filter((row) => !row.ok)
      .map((row) => ({
        market: row.marketName,
        error: row.error,
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

    const storageModes = [...new Set(rows.filter((row) => row.ok).map((row) => row.storage))];

    return NextResponse.json({
      source: marketsConfig.source,
      updatedAt: marketsConfig.updatedAt || null,
      fetchedAt: new Date().toISOString(),
      mode,
      rollingDays: ROLLING_DAYS,
      analysisDate: analysisDateISO,
      priorityMarketNames: priorityMarkets.map((market) => market.name),
      selectedMarketCount: selectedMarkets.length,
      totalConfiguredMarkets: allMarkets.length,
      storageModes,
      overview: aggregateOverview(
        markets,
        analysisDateISO,
        windowStartISO,
        prevWindowStartISO,
        prevAnalysisDateISO,
      ),
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
