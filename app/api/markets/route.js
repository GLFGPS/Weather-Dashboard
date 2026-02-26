import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MARKETS_FILE_PATH = path.join(process.cwd(), "data", "markets.json");

export async function GET() {
  try {
    const raw = await readFile(MARKETS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const markets = Array.isArray(parsed.markets) ? parsed.markets : [];

    return NextResponse.json({
      updatedAt: parsed.updatedAt || null,
      count: markets.length,
      markets,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error.message ||
          "Unable to load markets.json. Confirm data/markets.json exists and has valid JSON.",
      },
      { status: 500 },
    );
  }
}
