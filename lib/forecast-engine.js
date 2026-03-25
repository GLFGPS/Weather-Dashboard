import modelCoefficients from "../analysis/model_coefficients.json" with { type: "json" };

const DOW_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const DM_WAVES = modelCoefficients.dm_waves_2026?.waves || [];
const DM_WAVE_CURVE = modelCoefficients.dm_waves_2026?.response_curve_pct?.weights || [];
const DM_WAVE_WINDOW = 14;
const DM_NEUTRAL_BASE = modelCoefficients.dm_waves_2026?.weather_neutral_base_per_400k || 662;
const DM_WEATHER_SENSITIVITY = modelCoefficients.dm_weather_sensitivity?.sensitivity ?? 0.3;
const DM_PHASE_MULTS = modelCoefficients.dm_phase_multipliers || { Early: 0.5, Ramp: 1.0, Peak: 1.65, Tail: 0.8 };

const SEASON_PHASES = [
  { name: "Early", start: [2, 15], end: [3, 1] },
  { name: "Ramp", start: [3, 1], end: [3, 17] },
  { name: "Peak", start: [3, 17], end: [4, 16] },
  { name: "Tail", start: [4, 16], end: [5, 11] },
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

function computeWaveBasedDm(dateStr, orgWeatherMultiplier) {
  if (!DM_WAVE_CURVE.length || !DM_WAVES.length) return null;
  const target = new Date(`${dateStr}T00:00:00`).getTime();
  const weightSum = DM_WAVE_CURVE.reduce((s, w) => s + w, 0);
  const dmWeatherMult = 1 + (orgWeatherMultiplier - 1) * DM_WEATHER_SENSITIVITY;
  let dmTotal = 0;
  let activeWaveCount = 0;
  for (const wave of DM_WAVES) {
    const inHome = new Date(`${wave.in_home_start}T00:00:00`).getTime();
    const daysSinceInHome = Math.round((target - inHome) / 86400000);
    if (daysSinceInHome < 0 || daysSinceInHome >= DM_WAVE_WINDOW) continue;
    activeWaveCount += 1;
    const wavePhaseMult = DM_PHASE_MULTS[wave.phase] ?? 1.0;
    const weight = DM_WAVE_CURVE[daysSinceInHome] ?? 0;
    const units = (wave.total_pieces || 400000) / 400000;
    dmTotal += (weight / weightSum) * DM_NEUTRAL_BASE * units * wavePhaseMult * dmWeatherMult;
  }
  if (activeWaveCount === 0) return { dm: 0, activeWaves: 0 };
  return { dm: Math.round(dmTotal), activeWaves: activeWaveCount };
}

export function computeProjection(dateStr, { weather, dmInHome } = {}) {
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
  if (dmInHome) {
    const waveResult = computeWaveBasedDm(dateStr, weatherMultiplier);
    if (waveResult && waveResult.activeWaves > 0) {
      dmPredicted = waveResult.dm;
      dmMethod = "wave-curve";
    } else {
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
