import { NextResponse } from "next/server";
import { loadMarketsConfig } from "../../../../lib/markets";

export const runtime = "nodejs";

const VC_BASE_URL =
  "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline";

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDays(date, days) {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function classifyHeadwind(today, lookback, forecast) {
  let score = 0;

  const todaySnow = today?.snow ?? 0;
  const todaySnowDepth = today?.snowdepth ?? 0;
  const todayTempMax = today?.tempmax ?? null;

  if (todaySnow > 0) score += 2;
  if (todaySnowDepth >= 0.5) score += 3;
  if ((lookback?.snowDays ?? 0) >= 3) score += 2;
  if ((lookback?.maxSnowDepth ?? 0) >= 0.75) score += 2;
  if (todayTempMax !== null && todayTempMax < 42) score += 1;
  if ((lookback?.precipRate ?? 0) > 0.45) score += 1;

  const forecastFreezingNights = (forecast || []).filter(
    (day) => (day?.tempmin ?? 99) <= 30,
  ).length;
  if (forecastFreezingNights >= 2) score += 1;

  let headwindLevel = "low";
  let directMailSignal = "Conditions are generally favorable for normal cadence.";

  if (score >= 6) {
    headwindLevel = "high";
    directMailSignal =
      "Hold or trim heavy direct-mail drops. Snow/cold headwinds likely suppress near-term conversion intent.";
  } else if (score >= 3) {
    headwindLevel = "medium";
    directMailSignal =
      "Use caution. Keep direct-mail active but prioritize higher-intent segments and stagger volume.";
  }

  return {
    headwindLevel,
    headwindScore: score,
    directMailSignal,
  };
}

function formatDay(day) {
  if (!day) return null;
  return {
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
  };
}

async function fetchMarketTimeline(location, startDate, endDate, apiKey) {
  const encodedLocation = encodeURIComponent(location);
  const url =
    `${VC_BASE_URL}/${encodedLocation}/${startDate}/${endDate}` +
    `?unitGroup=us&include=current,days` +
    `&elements=datetime,temp,tempmax,tempmin,humidity,precip,precipprob,snow,snowdepth,conditions` +
    `&key=${apiKey}&contentType=json`;

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Visual Crossing failed for ${location} (${response.status}): ${text.slice(
        0,
        180,
      )}`,
    );
  }

  return response.json();
}

function buildMarketSummary(market, timelinePayload, todayISO) {
  const days = Array.isArray(timelinePayload.days) ? timelinePayload.days : [];
  const todayRaw = days.find((day) => day?.datetime === todayISO) || days[days.length - 1];
  const today = formatDay(todayRaw);

  const lookbackDays = days
    .filter((day) => day?.datetime && day.datetime <= todayISO)
    .map((day) => formatDay(day))
    .filter(Boolean);

  const forecast = days
    .filter((day) => day?.datetime && day.datetime > todayISO)
    .slice(0, 3)
    .map((day) => formatDay(day))
    .filter(Boolean);

  const highs = lookbackDays
    .map((day) => day.tempmax)
    .filter((value) => value !== null);
  const lows = lookbackDays
    .map((day) => day.tempmin)
    .filter((value) => value !== null);
  const snowValues = lookbackDays.map((day) => day.snow ?? 0);
  const snowDepthValues = lookbackDays.map((day) => day.snowdepth ?? 0);
  const precipDays = lookbackDays.filter((day) => (day.precip ?? 0) > 0).length;

  const lookback = {
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
    location: timelinePayload.resolvedAddress || market.name,
    today,
    lookback,
    forecast,
    ...headwind,
  };
}

function buildOverview(markets) {
  const totalMarkets = markets.length;
  const highHeadwinds = markets.filter((market) => market.headwindLevel === "high")
    .length;
  const mediumHeadwinds = markets.filter(
    (market) => market.headwindLevel === "medium",
  ).length;
  const lowHeadwinds = markets.filter((market) => market.headwindLevel === "low").length;

  const avgTodayTemp = mean(
    markets
      .map((market) => market.today?.temp)
      .filter((value) => value !== null && value !== undefined),
  );
  const avgSnowDepth = mean(
    markets
      .map((market) => market.today?.snowdepth ?? 0)
      .filter((value) => value !== null && value !== undefined),
  );

  return {
    totalMarkets,
    highHeadwinds,
    mediumHeadwinds,
    lowHeadwinds,
    avgTodayTemp,
    avgSnowDepth,
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
    const lookbackRequested = Number.parseInt(
      searchParams.get("lookbackDays") || "14",
      10,
    );
    const lookbackDays = Number.isFinite(lookbackRequested)
      ? Math.min(120, Math.max(7, lookbackRequested))
      : 14;

    const maxMarketsRequested = Number.parseInt(
      searchParams.get("maxMarkets") || "50",
      10,
    );
    const maxMarkets = Number.isFinite(maxMarketsRequested)
      ? Math.min(100, Math.max(1, maxMarketsRequested))
      : 50;

    const marketsConfig = await loadMarketsConfig();
    const markets = (marketsConfig.markets || []).slice(0, maxMarkets);

    if (!markets.length) {
      return NextResponse.json(
        { error: "No markets found in market configuration." },
        { status: 400 },
      );
    }

    const now = new Date();
    const todayISO = toISODate(now);
    const startDate = toISODate(shiftDays(now, -(lookbackDays - 1)));
    const endDate = toISODate(shiftDays(now, 3));

    const settled = await Promise.allSettled(
      markets.map(async (market) => {
        const payload = await fetchMarketTimeline(market.name, startDate, endDate, apiKey);
        return buildMarketSummary(market, payload, todayISO);
      }),
    );

    const marketResults = [];
    const errors = [];

    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      if (result.status === "fulfilled") {
        marketResults.push(result.value);
      } else {
        const name = markets[index]?.name || `market-${index + 1}`;
        errors.push({
          market: name,
          error: result.reason?.message || "Unknown weather fetch failure.",
        });
      }
    }

    if (!marketResults.length) {
      return NextResponse.json(
        {
          error:
            "Unable to load weather for configured markets. Check location formatting and API quota.",
          errors,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      source: marketsConfig.source,
      updatedAt: marketsConfig.updatedAt || null,
      fetchedAt: new Date().toISOString(),
      lookbackDays,
      overview: buildOverview(marketResults),
      markets: marketResults,
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
