import { NextResponse } from "next/server";
import { getLeadOverview, syncLeadFilesToDb } from "../../../../lib/leads-cache";

export const runtime = "nodejs";

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
