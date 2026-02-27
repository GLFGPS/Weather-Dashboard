import { NextResponse } from "next/server";
import modelCoefficients from "../../../../analysis/model_coefficients.json" with { type: "json" };

const DOW_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function classifyWeather({ tempMax, sunshineHrs, precipIn, snowfallIn }) {
  if (snowfallIn > 0.1) return "snow";
  if (precipIn > 0.25) return "rain";
  if (precipIn > 0.05) return "light_rain";
  if (sunshineHrs >= 8 && tempMax >= 65) return "sunny_warm";
  if (sunshineHrs >= 4) return "partly_cloudy";
  if (sunshineHrs < 2 && precipIn <= 0.05) return "cloudy_overcast";
  if (tempMax < 50 && sunshineHrs < 4) return "cloudy_cool";
  return "typical";
}

function getCalendarWeek(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((date - startOfYear) / 86400000) + 1;
  return Math.ceil(dayOfYear / 7);
}

function forecastDay({ date, tempMax, sunshineHrs, precipIn, snowfallIn }) {
  const d = new Date(`${date}T00:00:00`);
  const jsDow = d.getDay();
  const dowName = DOW_NAMES[jsDow];
  const calWeek = getCalendarWeek(date);

  const weekStr = String(calWeek);
  const seasonalBaseline =
    modelCoefficients.seasonal_baseline_weekly[weekStr] ?? null;

  if (seasonalBaseline === null) {
    return {
      date,
      dow: dowName,
      inSeason: false,
      predictedLeads: null,
      message: "Date is outside lawn season (weeks 7-19, ~Feb 15 - May 10)",
    };
  }

  const dowMultiplier = modelCoefficients.dow_multipliers[dowName] ?? 1.0;

  const weatherKey = classifyWeather({
    tempMax: tempMax ?? 55,
    sunshineHrs: sunshineHrs ?? 6,
    precipIn: precipIn ?? 0,
    snowfallIn: snowfallIn ?? 0,
  });
  const weatherInfo = modelCoefficients.weather_multipliers[weatherKey] ?? modelCoefficients.weather_multipliers.typical;
  const weatherMultiplier = weatherInfo.multiplier;

  const predicted = Math.round(seasonalBaseline * dowMultiplier * weatherMultiplier);

  const baselineForDow = Math.round(seasonalBaseline * dowMultiplier);
  const weatherUpliftPct = Math.round((weatherMultiplier - 1) * 100);

  return {
    date,
    dow: dowName,
    calendarWeek: calWeek,
    inSeason: true,
    seasonalBaseline,
    dowMultiplier: Math.round(dowMultiplier * 100) / 100,
    weatherCondition: weatherInfo.label,
    weatherMultiplier: Math.round(weatherMultiplier * 100) / 100,
    baselineForDow,
    weatherAdjustedPrediction: predicted,
    weatherUpliftPct,
    predictedLeads: predicted,
    inputs: { tempMax, sunshineHrs, precipIn, snowfallIn },
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const date = searchParams.get("date");
  if (!date) {
    return NextResponse.json(
      { error: "date parameter is required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const tempMax = searchParams.has("temp_max")
    ? Number(searchParams.get("temp_max"))
    : undefined;
  const sunshineHrs = searchParams.has("sunshine_hrs")
    ? Number(searchParams.get("sunshine_hrs"))
    : undefined;
  const precipIn = searchParams.has("precip_in")
    ? Number(searchParams.get("precip_in"))
    : undefined;
  const snowfallIn = searchParams.has("snowfall_in")
    ? Number(searchParams.get("snowfall_in"))
    : undefined;

  const dates = date.split(",").map((d) => d.trim());

  const forecasts = dates.map((d) =>
    forecastDay({
      date: d,
      tempMax,
      sunshineHrs,
      precipIn,
      snowfallIn,
    }),
  );

  return NextResponse.json({
    forecasts,
    model: {
      description:
        "Lawn lead forecast based on 5 years of historical data (2021-2025)",
      factors: "day_of_week + seasonal_curve + weather_condition",
      r_squared: 0.98,
      note: "Provide weather params for weather-adjusted forecast, otherwise uses typical weather baseline",
    },
  });
}
