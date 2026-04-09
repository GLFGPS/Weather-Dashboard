import modelCoefficients from "../analysis/model_coefficients.json" with { type: "json" };

const DOW_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const DM_DROPS_DEFAULT = modelCoefficients.dm_drops_2026?.drops || [];
const DM_WINDOW = 14;
const DM_WEATHER_SENSITIVITY = modelCoefficients.dm_weather_sensitivity?.sensitivity ?? 0.3;
const DM_RATE_BY_DOW = modelCoefficients.dm_drops_2026?.dm_rate_per_100k_by_dow || {
  monday: 19.3, tuesday: 19.6, wednesday: 19.1, thursday: 15.6,
  friday: 15.4, saturday: 8.8, sunday: 3.9,
};

const SEASON_PHASES = [
  { name: "Early", start: [2, 15], end: [3, 1] },
  { name: "Ramp", start: [3, 1], end: [3, 17] },
  { name: "Peak", start: [3, 17], end: [4, 16] },
  { name: "Tail", start: [4, 16], end: [5, 11] },
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

  if (activeDropCount === 0) return { dm: 0, activeDrops: 0 };
  const dm = Math.round((activePieces / 100000) * dowRate * dmWeatherMult);
  return { dm, activeDrops: activeDropCount };
}

export function computeProjection(dateStr, { weather, dmInHome, drops } = {}) {
  const d = new Date(`${dateStr}T00:00:00`);
  const jsDow = d.getDay();
  const dowName = DOW_NAMES[jsDow];
  const calWeek = getCalendarWeek(dateStr);
  const weekStr = String(calWeek);

  const organicBaseline = modelCoefficients.seasonal_baseline_weekly[weekStr] ?? null;
  if (organicBaseline === null) return null;

  const dowMultiplier = modelCoefficients.dow_multipliers[dowName] ?? 1.0;

  let weatherMultiplier = 1.0;
  let weatherCondition = "typical";
  if (weather && weather.tempMax != null) {
    weatherCondition = classifyWeather(weather);
    weatherMultiplier = (modelCoefficients.weather_multipliers[weatherCondition] ?? modelCoefficients.weather_multipliers.typical).multiplier;
  }

  let dmPredicted = 0;
  let dmMethod = "none";
  if (dmInHome !== false) {
    const dropResult = computeActivePiecesDm(dateStr, weatherMultiplier, drops);
    if (dropResult && dropResult.activeDrops > 0) {
      dmPredicted = dropResult.dm;
      dmMethod = "active-pieces";
    } else if (dmInHome) {
      const legacyAddon = modelCoefficients.dm_addon_weekly[weekStr] ?? 0;
      dmPredicted = Math.round(legacyAddon * dowMultiplier * weatherMultiplier);
      dmMethod = "legacy-weekly";
    }
  }

  const organicPredicted = Math.round(organicBaseline * dowMultiplier * weatherMultiplier);
  const phase = getSeasonPhase(dateStr);

  return {
    forecastDate: dateStr,
    projectedTotal: organicPredicted + dmPredicted,
    projectedOrganic: organicPredicted,
    projectedDm: dmPredicted,
    dow: dowName,
    calendarWeek: calWeek,
    seasonPhase: phase?.name ?? null,
    weatherCondition,
    weatherMultiplier,
    dmMethod,
    dmInHome: !!dmInHome,
    organicBaseline,
    dowMultiplier,
  };
}
