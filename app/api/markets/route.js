import { NextResponse } from "next/server";
import { loadMarketsConfig } from "../../../lib/markets";

export const runtime = "nodejs";

export async function GET() {
  try {
    const config = await loadMarketsConfig();
    const markets = Array.isArray(config.markets) ? config.markets : [];

    return NextResponse.json({
      source: config.source,
      updatedAt: config.updatedAt || null,
      count: markets.length,
      markets,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error.message ||
          "Unable to load market configuration. Confirm GMB Locations.csv or data/markets.json exists and is valid.",
      },
      { status: 500 },
    );
  }
}
