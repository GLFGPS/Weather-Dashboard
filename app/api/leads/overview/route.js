import { NextResponse } from "next/server";
import { getLeadOverview, syncLeadFilesToDb } from "../../../../lib/leads-cache";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const yearParam = Number.parseInt(searchParams.get("year") || "", 10);
    const benchmarkMarket =
      searchParams.get("benchmarkMarket")?.trim() || "West Chester,PA";

    const syncReport = await syncLeadFilesToDb();
    const overview = await getLeadOverview({
      year: Number.isFinite(yearParam) ? yearParam : null,
      benchmarkMarket,
      weatherApiKey: process.env.VISUAL_CROSSING_API_KEY || null,
    });

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      benchmarkMarket,
      storage: {
        leads: "neon",
        weather: overview.weatherStorage,
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
