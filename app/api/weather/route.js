import { NextResponse } from "next/server";

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

function formatDay(day) {
  if (!day) return null;

  return {
    datetime: day.datetime,
    tempmax: toNumber(day.tempmax),
    tempmin: toNumber(day.tempmin),
    temp: toNumber(day.temp),
    humidity: toNumber(day.humidity),
    precipprob: toNumber(day.precipprob),
    precip: toNumber(day.precip),
    snow: toNumber(day.snow) ?? 0,
    snowdepth: toNumber(day.snowdepth) ?? 0,
    conditions: day.conditions || null,
  };
}

function mean(values) {
  if (!values.length) return null;
  const total = values.reduce((sum, item) => sum + item, 0);
  return total / values.length;
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
  const index = sorted.findIndex((item) => item === target);
  if (index === -1) return null;
  return index + 1;
}

async function fetchTimeline(location, startDate, endDate, apiKey) {
  const encodedLocation = encodeURIComponent(location);
  const pathDate = endDate
    ? `${startDate}/${endDate}`
    : `${startDate}/${startDate}`;

  const url =
    `${VC_BASE_URL}/${encodedLocation}/${pathDate}` +
    `?unitGroup=us&include=current,days` +
    `&elements=datetime,tempmax,tempmin,temp,humidity,precipprob,precip,snow,snowdepth,conditions,feelslike,windspeed,winddir,sunrise,sunset,uvindex` +
    `&key=${apiKey}&contentType=json`;

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Visual Crossing request failed (${response.status}): ${text}`);
  }

  return response.json();
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
    const lookbackRequested = Number.parseInt(
      searchParams.get("lookbackDays") || "30",
      10,
    );
    const lookbackDays = Number.isFinite(lookbackRequested)
      ? Math.min(365, Math.max(3, lookbackRequested))
      : 30;

    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const todayISO = toISODate(now);
    const forecastEndISO = toISODate(shiftDays(now, 3));
    const lookbackStartISO = toISODate(shiftDays(now, -(lookbackDays - 1)));

    const sameDayDates = Array.from({ length: 4 }, (_, index) => {
      const date = new Date(now);
      date.setUTCFullYear(currentYear - (index + 1));
      return toISODate(date);
    });

    const weatherRequests = [
      fetchTimeline(location, todayISO, forecastEndISO, apiKey),
      fetchTimeline(location, lookbackStartISO, todayISO, apiKey),
      ...sameDayDates.map((date) => fetchTimeline(location, date, null, apiKey)),
    ];

    const [todayAndForecast, lookbackSeries, ...sameDayHistoryRaw] =
      await Promise.all(weatherRequests);

    const today = formatDay(todayAndForecast.days?.[0]);
    if (!today) {
      return NextResponse.json(
        { error: "No weather data returned for requested location." },
        { status: 502 },
      );
    }

    const forecast = (todayAndForecast.days || [])
      .slice(1, 4)
      .map((day) => formatDay(day))
      .filter(Boolean);

    const currentConditions = todayAndForecast.currentConditions || {};
    const current = {
      feelslike: toNumber(currentConditions.feelslike),
      humidity: toNumber(currentConditions.humidity),
      windspeed: toNumber(currentConditions.windspeed),
      winddir: toNumber(currentConditions.winddir),
      sunrise: currentConditions.sunrise || null,
      sunset: currentConditions.sunset || null,
      uvindex: toNumber(currentConditions.uvindex),
    };

    const lookbackDaysSeries = (lookbackSeries.days || [])
      .map((day) => formatDay(day))
      .filter(Boolean);

    const highValues = lookbackDaysSeries
      .map((day) => day.tempmax)
      .filter((value) => value !== null);
    const lowValues = lookbackDaysSeries
      .map((day) => day.tempmin)
      .filter((value) => value !== null);
    const snowValues = lookbackDaysSeries
      .map((day) => day.snow ?? 0)
      .filter((value) => value !== null);
    const snowDepthValues = lookbackDaysSeries
      .map((day) => day.snowdepth ?? 0)
      .filter((value) => value !== null);

    const lookback = {
      requestedDays: lookbackDays,
      returnedDays: lookbackDaysSeries.length,
      avgHigh: mean(highValues),
      avgLow: mean(lowValues),
      precipDays: lookbackDaysSeries.filter((day) => (day.precip ?? 0) > 0).length,
      snowDays: lookbackDaysSeries.filter(
        (day) => (day.snow ?? 0) > 0 || (day.snowdepth ?? 0) > 0,
      ).length,
      totalSnow: snowValues.reduce((sum, value) => sum + value, 0),
      maxSnowDepth: snowDepthValues.length ? Math.max(...snowDepthValues) : 0,
    };

    const sameDayHistory = sameDayHistoryRaw.map((entry, index) => {
      const day = formatDay(entry.days?.[0]);
      if (!day) return null;
      return {
        year: currentYear - (index + 1),
        ...day,
      };
    });

    const sameDayLastYear = sameDayHistory[0] || null;
    const sameDayPool = [
      {
        year: currentYear,
        tempmax: today.tempmax,
        tempmin: today.tempmin,
        humidity: today.humidity,
      },
      ...sameDayHistory.map((entry) => ({
        year: entry?.year,
        tempmax: entry?.tempmax ?? null,
        tempmin: entry?.tempmin ?? null,
        humidity: entry?.humidity ?? null,
      })),
    ];

    const sameDayHighValues = sameDayPool
      .map((entry) => entry.tempmax)
      .filter((value) => value !== null);
    const sameDayLowValues = sameDayPool
      .map((entry) => entry.tempmin)
      .filter((value) => value !== null);
    const sameDayHumidityValues = sameDayPool
      .map((entry) => entry.humidity)
      .filter((value) => value !== null);

    const highRank = rank(sameDayHighValues, today.tempmax, true);
    const lowRank = rank(sameDayLowValues, today.tempmin, false);
    const humidityRank = rank(sameDayHumidityValues, today.humidity, true);

    const sameDayFiveYear = {
      avgHigh: mean(sameDayHighValues),
      avgLow: mean(sameDayLowValues),
      avgHumidity: mean(sameDayHumidityValues),
      highRank,
      lowRank,
      humidityRank,
      highRankText: highRank
        ? `Rank: ${highRank}${ordinal(highRank)} highest in ${sameDayHighValues.length} years`
        : "Not enough high temperature history.",
      lowRankText: lowRank
        ? `Rank: ${lowRank}${ordinal(lowRank)} lowest in ${sameDayLowValues.length} years`
        : "Not enough low temperature history.",
      humidityRankText: humidityRank
        ? `Rank: ${humidityRank}${ordinal(humidityRank)} highest in ${sameDayHumidityValues.length} years`
        : "Not enough humidity history.",
    };

    return NextResponse.json({
      location: todayAndForecast.resolvedAddress || location,
      fetchedAt: new Date().toISOString(),
      today,
      current,
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
