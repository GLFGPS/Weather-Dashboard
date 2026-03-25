import { NextResponse } from "next/server";
import { getLeadOverview, syncLeadFilesToDb } from "../../../../lib/leads-cache";
import { hasDatabaseConnection } from "../../../../lib/db";
import { logProjection } from "../../../../lib/projection-log";
import { computeProjection } from "../../../../lib/forecast-engine";

export const runtime = "nodejs";

function isDmSource(source) {
  const upper = (source || "").toUpperCase();
  return upper.startsWith("DM") || upper.includes("DIRECT MAIL");
}

async function autoLogProjections(overview) {
  if (!hasDatabaseConnection()) return;

  try {
    const currentYear = new Date().getUTCFullYear();
    const currentSeries = (overview.yearSeries || []).find(
      (s) => s.year === currentYear,
    );
    if (!currentSeries?.points?.length) return;

    const dmInHome = true;

    for (const point of currentSeries.points) {
      const weather = point.weather
        ? { tempMax: point.weather.avgTempMax }
        : null;

      const projection = computeProjection(point.date, { weather, dmInHome });
      if (!projection) continue;

      const actualTotal = point.totalLeads || null;
      const actualDm = point.directMailLeads || null;
      const actualOrganic =
        actualTotal != null && actualDm != null
          ? actualTotal - actualDm
          : null;

      await logProjection({
        ...projection,
        actualTotal: actualTotal > 0 ? actualTotal : null,
        actualOrganic: actualOrganic > 0 ? actualOrganic : null,
        actualDm: actualDm > 0 ? actualDm : null,
      });
    }
  } catch {
    // projection logging is non-critical
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const yearParam = Number.parseInt(searchParams.get("year") || "", 10);
    const sourceFilter = searchParams.get("source")?.trim() || "All Sources";
    const compareYearsParam = (searchParams.get("compareYears") || "")
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));

    const syncReport = await syncLeadFilesToDb();
    const overview = await getLeadOverview({
      year: Number.isFinite(yearParam) ? yearParam : null,
      compareYears: compareYearsParam,
      sourceFilter,
      weatherApiKey: process.env.VISUAL_CROSSING_API_KEY || null,
    });

    autoLogProjections(overview).catch(() => {});

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      storage: {
        leads: "neon",
        weather: Array.isArray(overview.weatherStorage)
          ? overview.weatherStorage.join(", ")
          : overview.weatherStorage || "none",
      },
      syncReport,
      ...overview,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Failed to load lead overview.",
      },
      { status: 500 },
    );
  }
}
