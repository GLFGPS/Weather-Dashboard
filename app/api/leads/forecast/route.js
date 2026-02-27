import { NextResponse } from "next/server";
import modelCoefficients from "../../../../analysis/model_coefficients.json" with { type: "json" };

const DOW_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SEASON_PHASES = [
  { name: "Early", start: [2, 15], end: [3, 1], weatherSensitivity: "very high", niceUplift: 50, badDrag: -15 },
  { name: "Ramp", start: [3, 1], end: [3, 17], weatherSensitivity: "high", niceUplift: 34, badDrag: -16 },
  { name: "Peak", start: [3, 17], end: [4, 16], weatherSensitivity: "moderate", niceUplift: 10, badDrag: -9 },
  { name: "Tail", start: [4, 16], end: [5, 11], weatherSensitivity: "low-moderate", niceUplift: 5, badDrag: -18 },
];

function classifyWeather({ tempMax, precipProb, snowDepth }) {
  if ((snowDepth ?? 0) > 0.5) return "snow";
  if ((precipProb ?? 0) > 70) return "rain";
  if ((precipProb ?? 0) > 40) return "light_rain";
  if (tempMax >= 65 && (precipProb ?? 0) < 20) return "sunny_warm";
  if (tempMax >= 50 && (precipProb ?? 0) < 30) return "partly_cloudy";
  if (tempMax < 42) return "cloudy_overcast";
  if (tempMax < 50) return "cloudy_cool";
  return "typical";
}

function getCalendarWeek(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  const jan4 = new Date(date.getFullYear(), 0, 4);
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 1)) / 86400000) + 1;
  const jan4DayOfWeek = jan4.getDay() || 7;
  return Math.ceil((dayOfYear + jan4DayOfWeek - 1) / 7);
}

function getSeasonPhase(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const md = month * 100 + day;
  for (const phase of SEASON_PHASES) {
    const phaseStart = phase.start[0] * 100 + phase.start[1];
    const phaseEnd = phase.end[0] * 100 + phase.end[1];
    if (md >= phaseStart && md < phaseEnd) return phase;
  }
  return null;
}

function getDayOfSeason(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const feb15 = new Date(d.getFullYear(), 1, 15);
  return Math.floor((d - feb15) / 86400000);
}

function forecastDay({ date, weather, dmInHome, growthPct }) {
  const d = new Date(`${date}T00:00:00`);
  const jsDow = d.getDay();
  const dowName = DOW_NAMES[jsDow];
  const dowLabel = DOW_LABELS[jsDow];
  const calWeek = getCalendarWeek(date);
  const dayOfSeason = getDayOfSeason(date);
  const weekStr = String(calWeek);

  const organicBaseline = modelCoefficients.seasonal_baseline_weekly[weekStr] ?? null;
  if (organicBaseline === null) {
    return {
      date, dow: dowName, dowLabel, inSeason: false,
      predictedLeads: null,
      message: "Date is outside lawn season (weeks 7-19, ~Feb 15 - May 10)",
    };
  }

  const dmAddon = modelCoefficients.dm_addon_weekly[weekStr] ?? 0;
  const baseBeforeDow = dmInHome ? organicBaseline + dmAddon : organicBaseline;

  const growthMultiplier = 1 + (growthPct || 0) / 100;
  const dowMultiplier = modelCoefficients.dow_multipliers[dowName] ?? 1.0;

  const hasWeather = weather && weather.tempMax != null;
  let weatherKey = "typical";
  let weatherMultiplier = 1.0;
  let weatherLabel = "No forecast data";

  if (hasWeather) {
    weatherKey = classifyWeather({
      tempMax: weather.tempMax,
      precipProb: weather.precipProb,
      snowDepth: weather.snowDepth,
    });
    const weatherInfo = modelCoefficients.weather_multipliers[weatherKey] ?? modelCoefficients.weather_multipliers.typical;
    weatherMultiplier = weatherInfo.multiplier;
    weatherLabel = weatherInfo.label;
  }

  const predicted = Math.round(baseBeforeDow * dowMultiplier * weatherMultiplier * growthMultiplier);
  const weatherUpliftPct = Math.round((weatherMultiplier - 1) * 100);
  const dmPct = dmInHome && organicBaseline > 0 ? Math.round((dmAddon / organicBaseline) * 100) : 0;
  const phase = getSeasonPhase(date);

  return {
    date,
    dow: dowName,
    dowLabel,
    calendarWeek: calWeek,
    dayOfSeason,
    inSeason: true,
    organicBaseline: Math.round(organicBaseline * growthMultiplier),
    dmAddon: dmInHome ? Math.round(dmAddon * growthMultiplier) : 0,
    seasonalBaseline: Math.round(baseBeforeDow * growthMultiplier),
    dowMultiplier: Math.round(dowMultiplier * 100) / 100,
    weatherCondition: weatherLabel,
    weatherKey: hasWeather ? weatherKey : null,
    weatherMultiplier: Math.round(weatherMultiplier * 100) / 100,
    weatherUpliftPct,
    dmInHome: !!dmInHome,
    dmPct,
    predictedLeads: predicted,
    growthPct: growthPct || 0,
    phase: phase ? {
      name: phase.name,
      weatherSensitivity: phase.weatherSensitivity,
      niceUplift: phase.niceUplift,
      badDrag: phase.badDrag,
    } : null,
    weatherInput: hasWeather ? {
      tempMax: weather.tempMax,
      precipProb: weather.precipProb,
      snowDepth: weather.snowDepth,
    } : null,
  };
}

function buildSeasonalCurve(year, growthPct, dmInHome) {
  const growthMultiplier = 1 + (growthPct || 0) / 100;
  const curve = [];
  const feb15 = new Date(year, 1, 15);

  for (let dayOffset = 0; dayOffset <= 84; dayOffset++) {
    const d = new Date(feb15);
    d.setDate(d.getDate() + dayOffset);
    const dateStr = d.toISOString().slice(0, 10);
    const calWeek = getCalendarWeek(dateStr);
    const weekStr = String(calWeek);
    const organicBaseline = modelCoefficients.seasonal_baseline_weekly[weekStr] ?? null;
    if (organicBaseline === null) continue;

    const dmAddon = dmInHome ? (modelCoefficients.dm_addon_weekly[weekStr] ?? 0) : 0;
    const base = organicBaseline + dmAddon;
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const dayKey = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    curve.push({
      dayKey,
      date: dateStr,
      dayOfSeason: dayOffset,
      weekdayBaseline: Math.round(base * growthMultiplier),
      saturdayBaseline: Math.round(base * (modelCoefficients.dow_multipliers.saturday ?? 0.37) * growthMultiplier),
    });
  }
  return curve;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const growthPct = searchParams.has("growth_pct") ? Number(searchParams.get("growth_pct")) : 0;
  const dmInHome = searchParams.get("dm_in_home") === "1";

  if (searchParams.has("seasonal_curve")) {
    const year = Number(searchParams.get("seasonal_curve")) || new Date().getFullYear();
    const curve = buildSeasonalCurve(year, growthPct, dmInHome);
    return NextResponse.json({
      year, growthPct, dmInHome, curve,
      dowMultipliers: modelCoefficients.dow_multipliers,
      weatherMultipliers: modelCoefficients.weather_multipliers,
      phases: SEASON_PHASES.map((p) => ({
        name: p.name,
        start: `${p.start[0]}/${p.start[1]}`,
        end: `${p.end[0]}/${p.end[1]}`,
        weatherSensitivity: p.weatherSensitivity,
        niceUplift: p.niceUplift,
        badDrag: p.badDrag,
      })),
    });
  }

  const date = searchParams.get("date");
  if (!date) {
    return NextResponse.json(
      { error: "date parameter required (YYYY-MM-DD), or use seasonal_curve=YYYY" },
      { status: 400 },
    );
  }

  const weather = {};
  if (searchParams.has("temp_max")) weather.tempMax = Number(searchParams.get("temp_max"));
  if (searchParams.has("precip_prob")) weather.precipProb = Number(searchParams.get("precip_prob"));
  if (searchParams.has("snow_depth")) weather.snowDepth = Number(searchParams.get("snow_depth"));

  const hasWeather = Object.keys(weather).length > 0;
  const dates = date.split(",").map((d) => d.trim());

  const forecasts = dates.map((d) =>
    forecastDay({
      date: d,
      weather: hasWeather ? weather : null,
      dmInHome,
      growthPct,
    }),
  );

  return NextResponse.json({
    forecasts,
    model: {
      description: "Lawn lead forecast based on 5 years of historical data (2021-2025)",
      factors: "organic_baseline + dm_addon + dow + weather + growth",
      r_squared: 0.98,
      growthPct,
      dmInHome,
    },
  });
}
