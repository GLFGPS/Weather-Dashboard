import { NextResponse } from "next/server";
import path from "node:path";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

const WORKBOOK_FILE = "2022 Lawn Weather & Lead Data.xlsx";
const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedSummary = null;
let cachedAt = 0;

function increment(counter, key, amount = 1) {
  counter.set(key, (counter.get(key) || 0) + amount);
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
    return null;
  }

  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
    return null;
  }

  if (typeof value === "object") {
    if ("result" in value) return normalizeDate(value.result);
    if ("text" in value) return normalizeDate(value.text);
  }

  return null;
}

function toSortedArray(counter, keyName = "source") {
  return [...counter.entries()]
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((a, b) => b.count - a.count);
}

function monthOfISODate(isoDate) {
  const parts = isoDate.split("-");
  return Number(parts[1]);
}

async function buildSummary() {
  const workbookPath = path.join(process.cwd(), WORKBOOK_FILE);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);

  const leadsSheet = workbook.getWorksheet("Request Date & Source");
  const weatherSheet = workbook.getWorksheet("Philly Weather 2022");
  if (!leadsSheet || !weatherSheet) {
    throw new Error(
      "Workbook is missing required sheets: Request Date & Source or Philly Weather 2022.",
    );
  }

  const leadHeaderRow = leadsSheet.getRow(1);
  const leadColumnIndex = {};
  leadHeaderRow.eachCell((cell, columnNumber) => {
    leadColumnIndex[String(cell.value || "").trim()] = columnNumber;
  });

  const requestedDateColumn = leadColumnIndex.EstimateRequestedDate;
  const sourceColumn = leadColumnIndex.ProgramSourceDescription;
  if (!requestedDateColumn || !sourceColumn) {
    throw new Error(
      "Request Date & Source sheet is missing expected columns: EstimateRequestedDate or ProgramSourceDescription.",
    );
  }

  const leadByDate = new Map();
  const directMailByDate = new Map();
  const sourceCounts = new Map();
  const directMailChannels = new Map();

  let totalLeads = 0;
  leadsSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const leadDate = normalizeDate(row.getCell(requestedDateColumn).value);
    if (!leadDate) return;

    const sourceRaw = row.getCell(sourceColumn).value;
    const source = String(sourceRaw || "Unknown").trim() || "Unknown";

    totalLeads += 1;
    increment(leadByDate, leadDate);
    increment(sourceCounts, source);

    if (source.toUpperCase().startsWith("DM")) {
      increment(directMailByDate, leadDate);
      increment(directMailChannels, source);
    }
  });

  const weatherHeaderRow = weatherSheet.getRow(1);
  const weatherColumnIndex = {};
  weatherHeaderRow.eachCell((cell, columnNumber) => {
    weatherColumnIndex[String(cell.value || "").trim()] = columnNumber;
  });

  const requiredWeatherColumns = ["datetime", "snow", "snowdepth", "tempmin", "tempmax"];
  for (const columnName of requiredWeatherColumns) {
    if (!weatherColumnIndex[columnName]) {
      throw new Error(`Philly Weather 2022 sheet is missing column: ${columnName}`);
    }
  }

  const weatherByDate = new Map();
  weatherSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const date = normalizeDate(row.getCell(weatherColumnIndex.datetime).value);
    if (!date) return;

    weatherByDate.set(date, {
      snow: asNumber(row.getCell(weatherColumnIndex.snow).value) ?? 0,
      snowdepth: asNumber(row.getCell(weatherColumnIndex.snowdepth).value) ?? 0,
      tempmin: asNumber(row.getCell(weatherColumnIndex.tempmin).value),
      tempmax: asNumber(row.getCell(weatherColumnIndex.tempmax).value),
    });
  });

  const joined = [];
  for (const [date, leads] of leadByDate.entries()) {
    const weather = weatherByDate.get(date);
    if (!weather) continue;

    joined.push({
      date,
      leads,
      directMailLeads: directMailByDate.get(date) || 0,
      ...weather,
    });
  }

  joined.sort((a, b) => a.date.localeCompare(b.date));

  const snowDays = joined.filter(
    (entry) => (entry.snow ?? 0) > 0 || (entry.snowdepth ?? 0) > 0,
  );
  const nonSnowDays = joined.filter(
    (entry) => (entry.snow ?? 0) <= 0 && (entry.snowdepth ?? 0) <= 0,
  );

  const avgLeadsOnSnowDays = snowDays.length
    ? snowDays.reduce((sum, row) => sum + row.leads, 0) / snowDays.length
    : 0;
  const avgLeadsOnNonSnowDays = nonSnowDays.length
    ? nonSnowDays.reduce((sum, row) => sum + row.leads, 0) / nonSnowDays.length
    : 0;

  const leadDates = [...leadByDate.keys()].sort();
  const directMailTotal = [...directMailChannels.values()].reduce(
    (sum, count) => sum + count,
    0,
  );

  const lateSeasonEvents = snowDays
    .filter((entry) => {
      const month = monthOfISODate(entry.date);
      return month === 3 || month === 4;
    })
    .slice(0, 20);

  return {
    workbook: WORKBOOK_FILE,
    generatedAt: new Date().toISOString(),
    leads: {
      total: totalLeads,
      dateRange: {
        start: leadDates[0] || null,
        end: leadDates[leadDates.length - 1] || null,
        daysWithLeads: leadDates.length,
      },
      topSources: toSortedArray(sourceCounts).slice(0, 12),
      directMail: {
        total: directMailTotal,
        pctOfTotal: totalLeads ? (directMailTotal / totalLeads) * 100 : 0,
        channels: toSortedArray(directMailChannels),
      },
    },
    weatherImpact: {
      snowDaysWithLeads: snowDays.length,
      avgLeadsOnSnowDays,
      avgLeadsOnNonSnowDays,
      lateSeasonEvents,
    },
  };
}

export async function GET() {
  try {
    const now = Date.now();
    if (cachedSummary && now - cachedAt < CACHE_TTL_MS) {
      return NextResponse.json({ ...cachedSummary, cache: "hit" });
    }

    const summary = await buildSummary();
    cachedSummary = summary;
    cachedAt = now;

    return NextResponse.json({ ...summary, cache: "miss" });
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Failed to build 2022 workbook summary.",
      },
      { status: 500 },
    );
  }
}
