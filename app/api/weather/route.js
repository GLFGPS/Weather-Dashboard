import { NextResponse } from "next/server";
import {
  formatISODate,
  getOrFetchWeatherRange,
  shiftDays,
} from "../../../lib/weather-cache";
import { loadMarketsConfig } from "../../../lib/markets";

const SEASON_END_MONTH_INDEX = 4;
const SEASON_END_DAY = 10;
const HISTORICAL_YEARS = 5;

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampToSeasonEnd(date) {
  const seasonEnd = new Date(
    Date.UTC(date.getUTCFullYear(), SEASON_END_MONTH_INDEX, SEASON_END_DAY),
  );
  return date > seasonEnd ? seasonEnd : date;
}

function ordinal(value) {
  const ten = value % 10;
  const hundred = value % 100;
  if (ten === 1 && hundred !== 11) return "st";
  if (ten === 2 && hundred !== 12) return "nd";
  if (ten === 3 && hundred !== 13) return "rd";
  return "th";
}

function rank(values, target, desc = true) {
  if (!values.length || target === null || target === undefined) return null;
  const sorted = [...values].sort((a, b) => (desc ? b - a : a - b));
  const index = sorted.findIndex((value) => value === target);
  return index >= 0 ? index + 1 : null;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summarizeWindow(days) {
  const maxTemps = days.map((day) => toNumber(day.tempmax)).filter((value) => value !== null);
  const minTemps = days.map((day) => toNumber(day.tempmin)).filter((value) => value !== null);
  const uvs = days.map((day) => toNumber(day.uvindex)).filter((value) => value !== null);
  const snowDepths = days
    .map((day) => toNumber(day.snowdepth))
    .filter((value) => value !== null);
  const precips = days.map((day) => toNumber(day.precip)).filter((value) => value !== null);
  const humidities = days
    .map((day) => toNumber(day.humidity))
    .filter((value) => value !== null);
  const snowfall = days.map((day) => toNumber(day.snow)).filter((value) => value !== null);

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
    safeCurrent !== null && safePrevious !== null ? safeCurrent - safePrevious : null;
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

function averageMetricSummaries(summaries) {
  const keys = [
    "avgMaxTemp",
    "avgMinTemp",
    "avgUv",
    "avgSnowDepth",
    "avgPrecip",
    "avgHumidity",
    "avgSnowfall",
    "snowDays",
  ];
  const output = {};
  for (const key of keys) {
    output[key] = mean(
      summaries
        .map((summary) => summary?.[key])
        .filter((value) => value !== null && value !== undefined),
    );
  }
  return output;
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
    const location = searchParams.get("location")?.trim() || "West Chester,PA";
    const marketsConfig = await loadMarketsConfig();
    const configuredMarkets = Array.isArray(marketsConfig.markets) ? marketsConfig.markets : [];
    const marketMatch = configuredMarkets.find((market) => market.name === location);
    const weatherLocation = marketMatch?.weatherQuery || location;
    const analysisDateInput = searchParams.get("analysisDate")?.trim();
    const parsedAnalysisDate = analysisDateInput
      ? new Date(`${analysisDateInput}T00:00:00Z`)
      : null;
    const lookbackRequested = Number.parseInt(
      searchParams.get("lookbackDays") || "30",
      10,
    );
    const lookbackDays = Number.isFinite(lookbackRequested)
      ? Math.min(365, Math.max(3, lookbackRequested))
      : 30;

    const now = new Date();
    const anchorDateRaw =
      parsedAnalysisDate && !Number.isNaN(parsedAnalysisDate.getTime()) && parsedAnalysisDate <= now
        ? parsedAnalysisDate
        : now;
    const anchorDate = clampToSeasonEnd(anchorDateRaw);
    const currentYear = anchorDate.getUTCFullYear();
    const analysisDateISO = formatISODate(anchorDate);
    const forecastEndISO = formatISODate(clampToSeasonEnd(shiftDays(anchorDate, 3)));
    const lookbackStartISO = formatISODate(shiftDays(anchorDate, -(lookbackDays - 1)));

    const primaryRange = await getOrFetchWeatherRange({
      marketName: weatherLocation,
      startDate: lookbackStartISO,
      endDate: forecastEndISO,
      apiKey,
    });

    const allDays = primaryRange.days || [];
    const selectedDay =
      allDays.find((day) => day.datetime === analysisDateISO) ||
      allDays[allDays.length - 1] ||
      null;

    if (!selectedDay) {
      return NextResponse.json(
        { error: "No weather data returned for requested location." },
        { status: 502 },
      );
    }

    const forecast = allDays
      .filter((day) => day.datetime > analysisDateISO)
      .slice(0, 3)
      .map((day) => ({
        datetime: day.datetime,
        temp: day.temp,
        tempmax: day.tempmax,
        tempmin: day.tempmin,
        humidity: day.humidity,
        precip: day.precip,
        precipprob: day.precipprob,
        snow: day.snow,
        snowdepth: day.snowdepth,
        conditions: day.conditions,
      }));

    const lookbackSeries = allDays.filter(
      (day) => day.datetime >= lookbackStartISO && day.datetime <= analysisDateISO,
    );

    const highs = lookbackSeries
      .map((day) => day.tempmax)
      .filter((value) => value !== null && value !== undefined);
    const lows = lookbackSeries
      .map((day) => day.tempmin)
      .filter((value) => value !== null && value !== undefined);
    const snowValues = lookbackSeries.map((day) => day.snow ?? 0);
    const snowDepthValues = lookbackSeries.map((day) => day.snowdepth ?? 0);

    const lookback = {
      requestedDays: lookbackDays,
      returnedDays: lookbackSeries.length,
      avgHigh: mean(highs),
      avgLow: mean(lows),
      precipDays: lookbackSeries.filter((day) => (day.precip ?? 0) > 0).length,
      snowDays: lookbackSeries.filter(
        (day) => (day.snow ?? 0) > 0 || (day.snowdepth ?? 0) > 0,
      ).length,
      totalSnow: snowValues.reduce((sum, value) => sum + value, 0),
      maxSnowDepth: snowDepthValues.length ? Math.max(...snowDepthValues) : 0,
    };

    const sameDayDates = Array.from({ length: 4 }, (_, index) => {
      const past = new Date(anchorDate);
      past.setUTCFullYear(currentYear - (index + 1));
      return formatISODate(past);
    });

    const sameDayHistory = [];
    for (let index = 0; index < sameDayDates.length; index += 1) {
      const date = sameDayDates[index];
      const data = await getOrFetchWeatherRange({
        marketName: weatherLocation,
        startDate: date,
        endDate: date,
        apiKey,
      });
      const day = data.days[0];
      if (!day) continue;
      sameDayHistory.push({
        year: currentYear - (index + 1),
        ...day,
      });
    }

    const sameDayLastYear = sameDayHistory[0] || null;

    const sameDayPool = [
      {
        year: currentYear,
        tempmax: selectedDay.tempmax,
        tempmin: selectedDay.tempmin,
        humidity: selectedDay.humidity,
      },
      ...sameDayHistory.map((day) => ({
        year: day.year,
        tempmax: day.tempmax,
        tempmin: day.tempmin,
        humidity: day.humidity,
      })),
    ];

    const sameDayHighs = sameDayPool
      .map((row) => row.tempmax)
      .filter((value) => value !== null && value !== undefined);
    const sameDayLows = sameDayPool
      .map((row) => row.tempmin)
      .filter((value) => value !== null && value !== undefined);
    const sameDayHumidities = sameDayPool
      .map((row) => row.humidity)
      .filter((value) => value !== null && value !== undefined);

    const highRank = rank(sameDayHighs, selectedDay.tempmax, true);
    const lowRank = rank(sameDayLows, selectedDay.tempmin, false);
    const humidityRank = rank(sameDayHumidities, selectedDay.humidity, true);

    const sameDayFiveYear = {
      avgHigh: mean(sameDayHighs),
      avgLow: mean(sameDayLows),
      avgHumidity: mean(sameDayHumidities),
      highRank,
      lowRank,
      humidityRank,
      highRankText: highRank
        ? `Rank: ${highRank}${ordinal(highRank)} highest in ${sameDayHighs.length} years`
        : "Not enough high temperature history.",
      lowRankText: lowRank
        ? `Rank: ${lowRank}${ordinal(lowRank)} lowest in ${sameDayLows.length} years`
        : "Not enough low temperature history.",
      humidityRankText: humidityRank
        ? `Rank: ${humidityRank}${ordinal(humidityRank)} highest in ${sameDayHumidities.length} years`
        : "Not enough humidity history.",
    };

    const priorStartISO = formatISODate(shiftDays(anchorDate, -6));
    const priorEndISO = analysisDateISO;
    const nextStartISO = formatISODate(shiftDays(anchorDate, 1));
    const nextEndISO = formatISODate(shiftDays(anchorDate, 7));

    const priorWindowRange = await getOrFetchWeatherRange({
      marketName: weatherLocation,
      startDate: priorStartISO,
      endDate: priorEndISO,
      apiKey,
    });
    const nextWindowRange = await getOrFetchWeatherRange({
      marketName: weatherLocation,
      startDate: nextStartISO,
      endDate: nextEndISO,
      apiKey,
    });

    const priorHistory = [];
    const nextHistory = [];
    for (let yearsBack = 1; yearsBack <= HISTORICAL_YEARS; yearsBack += 1) {
      const historicalAnchor = new Date(anchorDate);
      historicalAnchor.setUTCFullYear(historicalAnchor.getUTCFullYear() - yearsBack);

      const historicalPriorEndISO = formatISODate(historicalAnchor);
      const historicalPriorStartISO = formatISODate(shiftDays(historicalAnchor, -6));
      const historicalNextStartISO = formatISODate(shiftDays(historicalAnchor, 1));
      const historicalNextEndISO = formatISODate(shiftDays(historicalAnchor, 7));

      const priorHistoryRange = await getOrFetchWeatherRange({
        marketName: weatherLocation,
        startDate: historicalPriorStartISO,
        endDate: historicalPriorEndISO,
        apiKey,
      });
      const nextHistoryRange = await getOrFetchWeatherRange({
        marketName: weatherLocation,
        startDate: historicalNextStartISO,
        endDate: historicalNextEndISO,
        apiKey,
      });
      priorHistory.push(summarizeWindow(priorHistoryRange.days || []));
      nextHistory.push(summarizeWindow(nextHistoryRange.days || []));
    }

    const priorMetrics = summarizeWindow(priorWindowRange.days || []);
    const nextMetrics = summarizeWindow(nextWindowRange.days || []);
    const priorBaseline = averageMetricSummaries(priorHistory);
    const nextBaseline = averageMetricSummaries(nextHistory);
    const rollingComparisons = {
      comparisonLabel: "vs 5Y Avg",
      prior7: {
        startDate: priorStartISO,
        endDate: priorEndISO,
        cards: compareMetrics(priorMetrics, priorBaseline),
      },
      next7: {
        startDate: nextStartISO,
        endDate: nextEndISO,
        cards: compareMetrics(nextMetrics, nextBaseline),
      },
    };

    return NextResponse.json({
      location: primaryRange.resolvedAddress || location,
      fetchedAt: new Date().toISOString(),
      storage: primaryRange.storage,
      analysisDate: analysisDateISO,
      dateRange: {
        start: lookbackStartISO,
        end: analysisDateISO,
      },
      selectedDay,
      dailyHistory: lookbackSeries,
      current: {
        feelslike: selectedDay.feelslike,
        humidity: selectedDay.humidity,
        windspeed: selectedDay.windspeed,
        winddir: selectedDay.winddir,
        sunrise: selectedDay.sunrise,
        sunset: selectedDay.sunset,
        uvindex: selectedDay.uvindex,
      },
      forecast,
      lookback,
      sameDayLastYear,
      sameDayFiveYear,
      rollingComparisons,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Unknown weather API error.",
      },
      { status: 500 },
    );
  }
}
