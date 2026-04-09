import { NextResponse } from "next/server";
import modelCoefficients from "../../../../analysis/model_coefficients.json" with { type: "json" };

const DOW_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DM_DROPS_DEFAULT = modelCoefficients.dm_drops_2026?.drops || [];
const DM_WINDOW = 14;
const DM_WEATHER_SENSITIVITY = modelCoefficients.dm_weather_sensitivity?.sensitivity ?? 0.3;
const DM_RATE_BY_DOW = modelCoefficients.dm_drops_2026?.dm_rate_per_100k_by_dow || {
  monday: 19.3, tuesday: 19.6, wednesday: 19.1, thursday: 15.6,
  friday: 15.4, saturday: 8.8, sunday: 3.9,
};

const SEASON_PHASES = [
  { name: "Early", start: [2, 15], end: [3, 1], weatherSensitivity: "very high", niceUplift: 50, badDrag: -15 },
  { name: "Ramp", start: [3, 1], end: [3, 17], weatherSensitivity: "high", niceUplift: 34, badDrag: -16 },
  { name: "Peak", start: [3, 17], end: [4, 16], weatherSensitivity: "moderate", niceUplift: 10, badDrag: -9 },
  { name: "Tail", start: [4, 16], end: [5, 11], weatherSensitivity: "low-moderate", niceUplift: 5, badDrag: -18 },
];

function classifyWeather({ tempMax, precipProb, snowDepth, snowfall }) {
  const snow = snowfall ?? snowDepth ?? 0;
  if (snow > 1.0) return "snow";
  if (snow > 0.1 && tempMax < 45) return "snow";
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

function computeActivePiecesDm(dateStr, orgWeatherMultiplier, drops) {
  const dropList = drops || DM_DROPS_DEFAULT;
  if (!dropList.length) return null;

  const normalized = dropList.map((d) => ({
    ...d,
    in_home_date: d.in_home_date || (() => {
      const dt = new Date(`${d.drop_date}T00:00:00`);
      dt.setDate(dt.getDate() + 3);
      return dt.toISOString().slice(0, 10);
    })(),
  }));

  const target = new Date(`${dateStr}T00:00:00`);
  const targetMs = target.getTime();
  const dowName = DOW_NAMES[target.getDay()];
  const dmWeatherMult = 1 + (orgWeatherMultiplier - 1) * DM_WEATHER_SENSITIVITY;
  const dowRate = DM_RATE_BY_DOW[dowName] ?? 10;

  let activePieces = 0;
  let activeDropCount = 0;

  for (const drop of normalized) {
    const inHome = new Date(`${drop.in_home_date}T00:00:00`).getTime();
    const daysSinceInHome = Math.round((targetMs - inHome) / 86400000);
    if (daysSinceInHome < 0 || daysSinceInHome >= DM_WINDOW) continue;
    activePieces += drop.pieces;
    activeDropCount += 1;
  }

  if (activeDropCount === 0) return { dm: 0, activeDrops: 0, method: "active-pieces" };
  const dm = Math.round((activePieces / 100000) * dowRate * dmWeatherMult);
  return { dm, activeDrops: activeDropCount, method: "active-pieces" };
}

function forecastDay({ date, weather, dmInHome, drops }) {
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

  let dmAddon = 0;
  let dmMethod = "none";
  let activeDrops = 0;

  if (dmInHome !== false) {
    const dropResult = computeActivePiecesDm(date, weatherMultiplier, drops);
    if (dropResult && dropResult.activeDrops > 0) {
      dmAddon = dropResult.dm;
      dmMethod = dropResult.method;
      activeDrops = dropResult.activeDrops;
    } else if (dmInHome) {
      const legacyAddon = modelCoefficients.dm_addon_weekly[weekStr] ?? 0;
      dmAddon = Math.round(legacyAddon * dowMultiplier * weatherMultiplier);
      dmMethod = "legacy-weekly";
    }
  }

  const organicPredicted = Math.round(organicBaseline * dowMultiplier * weatherMultiplier);
  const dmPredicted = dmAddon;
  const totalPredicted = organicPredicted + dmPredicted;

  const weatherUpliftPct = Math.round((weatherMultiplier - 1) * 100);
  const dmPct = dmInHome && organicPredicted > 0 ? Math.round((dmPredicted / organicPredicted) * 100) : 0;
  const phase = getSeasonPhase(date);

  return {
    date,
    dow: dowName,
    dowLabel,
    calendarWeek: calWeek,
    dayOfSeason,
    inSeason: true,
    organicBaseline,
    dmAddon: dmPredicted,
    seasonalBaseline: organicBaseline + dmPredicted,
    dowMultiplier: Math.round(dowMultiplier * 100) / 100,
    weatherCondition: weatherLabel,
    weatherKey: hasWeather ? weatherKey : null,
    weatherMultiplier: Math.round(weatherMultiplier * 100) / 100,
    weatherUpliftPct,
    dmInHome: !!dmInHome,
    dmPct,
    dmMethod,
    activeDrops,
    predictedLeads: totalPredicted,
    growthPct: 10,
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

function buildSeasonalCurve(year, dmInHome, drops) {
  const curve = [];
  const feb15 = new Date(year, 1, 15);
  const satMult = modelCoefficients.dow_multipliers.saturday ?? 0.50;

  for (let dayOffset = 0; dayOffset <= 84; dayOffset++) {
    const d = new Date(feb15);
    d.setDate(d.getDate() + dayOffset);
    const dateStr = d.toISOString().slice(0, 10);
    const calWeek = getCalendarWeek(dateStr);
    const weekStr = String(calWeek);
    const organicBaseline = modelCoefficients.seasonal_baseline_weekly[weekStr] ?? null;
    if (organicBaseline === null) continue;

    let dmAddon = 0;
    if (dmInHome) {
      const dropResult = computeActivePiecesDm(dateStr, 1.0, drops);
      if (dropResult && dropResult.activeDrops > 0) {
        dmAddon = dropResult.dm;
      } else {
        dmAddon = modelCoefficients.dm_addon_weekly[weekStr] ?? 0;
      }
    }

    const base = organicBaseline + dmAddon;
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const dayKey = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    curve.push({
      dayKey,
      date: dateStr,
      dayOfSeason: dayOffset,
      weekdayBaseline: base,
      saturdayBaseline: Math.round(organicBaseline * satMult + (dmInHome ? dmAddon * satMult : 0)),
    });
  }
  return curve;
}

function parseDropsParam(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((d) => d.drop_date && d.pieces)
      .map((d) => ({
        drop_date: d.drop_date,
        in_home_date: d.in_home_date || (() => {
          const dt = new Date(`${d.drop_date}T00:00:00`);
          dt.setDate(dt.getDate() + 3);
          return dt.toISOString().slice(0, 10);
        })(),
        pieces: Number(d.pieces) || 200000,
        phase: d.phase || null,
      }));
  } catch {
    return null;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const dmInHome = searchParams.get("dm_in_home") !== "0";
  const customDrops = parseDropsParam(searchParams.get("drops"));

  if (searchParams.has("seasonal_curve")) {
    const year = Number(searchParams.get("seasonal_curve")) || new Date().getFullYear();
    const curve = buildSeasonalCurve(year, dmInHome, customDrops);
    return NextResponse.json({
      year, growthPct: 10, dmInHome, curve,
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
      drops: customDrops,
    }),
  );

  return NextResponse.json({
    forecasts,
    model: {
      description: "Lawn lead forecast with +10% growth baked in. Organic baselines recalibrated from 2026 actuals (weeks 13-15). DM uses empirical rate per 100K active pieces by DOW from 34 days of 2026 data.",
      factors: "organic_baseline × DOW × weather + (active_DM_pieces / 100K × DOW_rate × weather_dampened)",
      r_squared: 0.98,
      growthPct: 10,
      dmInHome,
      dmMethod: "active-pieces-by-dow",
      dropCount: customDrops ? customDrops.length : DM_DROPS_DEFAULT.length,
    },
  });
}
