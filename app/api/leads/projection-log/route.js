import { NextResponse } from "next/server";
import { logProjection, getProjectionLog, updateActuals } from "../../../../lib/projection-log";
import { hasDatabaseConnection } from "../../../../lib/db";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    if (!hasDatabaseConnection()) {
      return NextResponse.json(
        { error: "Database connection required for projection log." },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("start") || null;
    const endDate = searchParams.get("end") || null;

    const log = await getProjectionLog({ startDate, endDate });

    const withError = log.filter((r) => r.actual_total != null);
    const mae =
      withError.length > 0
        ? withError.reduce((s, r) => s + Math.abs(r.error), 0) / withError.length
        : null;
    const avgErrorPct =
      withError.length > 0
        ? withError.reduce((s, r) => s + Math.abs(Number(r.error_pct) || 0), 0) / withError.length
        : null;

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      totalEntries: log.length,
      entriesWithActuals: withError.length,
      mae: mae !== null ? Math.round(mae * 10) / 10 : null,
      avgAbsErrorPct: avgErrorPct !== null ? Math.round(avgErrorPct * 10) / 10 : null,
      log,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to retrieve projection log." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    if (!hasDatabaseConnection()) {
      return NextResponse.json(
        { error: "Database connection required for projection log." },
        { status: 500 },
      );
    }

    const payload = await request.json();

    if (payload.action === "update_actuals" && payload.entries) {
      for (const entry of payload.entries) {
        await updateActuals({
          forecastDate: entry.date,
          actualTotal: entry.actualTotal,
          actualOrganic: entry.actualOrganic ?? null,
          actualDm: entry.actualDm ?? null,
        });
      }
      return NextResponse.json({
        updated: payload.entries.length,
        message: "Actuals updated.",
      });
    }

    if (payload.entries) {
      for (const entry of payload.entries) {
        await logProjection(entry);
      }
      return NextResponse.json({
        logged: payload.entries.length,
        message: "Projections logged.",
      });
    }

    return NextResponse.json(
      { error: "Provide entries array with projection data." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to log projection." },
      { status: 500 },
    );
  }
}
