import { NextResponse } from "next/server";
import {
  formatISODate,
  getOrFetchWeatherRange,
  shiftDays,
} from "../../../lib/weather-cache";

const SEASON_END_MONTH_INDEX = 4;
const SEASON_END_DAY = 10;

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
      marketName: location,
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
        marketName: location,
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
