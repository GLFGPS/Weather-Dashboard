import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";

export const runtime = "nodejs";

const VC_BASE_URL =
  "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline";

const DEFAULT_DATE_CANDIDATES = [
  "EstimateRequestedDate",
  "request_date",
  "requested_date",
  "lead_date",
  "date",
  "created_at",
];

const DEFAULT_CHANNEL_CANDIDATES = [
  "ProgramSourceDescription",
  "source",
  "channel",
  "lead_source",
  "program_source",
];

const DEFAULT_MARKET_CANDIDATES = [
  "market",
  "location",
  "city",
  "branch",
  "BranchNameOfCustomer",
];

function normalizeHeaderKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function excelSerialToDate(value) {
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const milliseconds = Math.round(value * 24 * 60 * 60 * 1000);
  return new Date(excelEpoch.getTime() + milliseconds);
}

function normalizeDate(value) {
  const extracted = extractCellValue(value);
  if (extracted === null || extracted === undefined || extracted === "") {
    return null;
  }

  if (extracted instanceof Date) {
    return extracted.toISOString().slice(0, 10);
  }

  if (typeof extracted === "number") {
    const date = excelSerialToDate(extracted);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
    return null;
  }

  if (typeof extracted === "string") {
    const valueTrimmed = extracted.trim();
    if (!valueTrimmed) return null;

    const usFormat = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
    const usMatch = valueTrimmed.match(usFormat);
    if (usMatch) {
      const month = Number(usMatch[1]);
      const day = Number(usMatch[2]);
      const yearRaw = Number(usMatch[3]);
      const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
      const date = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }

    const date = new Date(valueTrimmed);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  return null;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractCellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;

  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined) {
      return value.result;
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text || "").join("");
    }
    if ("hyperlink" in value && typeof value.text === "string") {
      return value.text;
    }
  }

  return value;
}

function toCleanString(value, fallback = "") {
  const cleaned = extractCellValue(value);
  if (cleaned === null || cleaned === undefined) return fallback;
  const result = String(cleaned).trim();
  return result || fallback;
}

function isDirectMailChannel(value) {
  const channel = String(value || "").toUpperCase();
  return channel.startsWith("DM") || channel.includes("DIRECT MAIL");
}

function toSortedCounts(map, labelKey = "label") {
  return [...map.entries()]
    .map(([label, count]) => ({ [labelKey]: label, count }))
    .sort((a, b) => b.count - a.count);
}

function chooseColumn(headers, explicit, candidates) {
  const headerMap = new Map();
  headers.forEach((header) => {
    headerMap.set(normalizeHeaderKey(header), header);
  });

  if (explicit) {
    const found = headerMap.get(normalizeHeaderKey(explicit));
    if (found) return found;
  }

  for (const candidate of candidates) {
    const found = headerMap.get(normalizeHeaderKey(candidate));
    if (found) return found;
  }

  return null;
}

async function parseCsvRows(buffer) {
  const content = buffer.toString("utf8");
  const rows = parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });

  const firstRow = rows[0] || {};
  const headers = Object.keys(firstRow);
  return { headers, rows };
}

async function parseExcelRows(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { headers: [], rows: [] };
  }

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const headerText = toCleanString(cell.value);
    if (headerText) {
      headers[columnNumber - 1] = headerText;
    }
  });

  const cleanedHeaders = headers.filter(Boolean);
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    let hasData = false;
    const rowObject = {};

    headers.forEach((header, index) => {
      if (!header) return;
      const value = extractCellValue(row.getCell(index + 1).value);
      if (
        value !== null &&
        value !== undefined &&
        !(typeof value === "string" && !value.trim())
      ) {
        hasData = true;
      }
      rowObject[header] = value;
    });

    if (hasData) {
      rows.push(rowObject);
    }
  });

  return { headers: cleanedHeaders, rows };
}

async function parseRowsFromFile(file) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = String(file.name || "").toLowerCase();

  if (fileName.endsWith(".csv")) {
    return parseCsvRows(buffer);
  }

  if (fileName.endsWith(".xlsx") || fileName.endsWith(".xlsm")) {
    return parseExcelRows(buffer);
  }

  if (fileName.endsWith(".xls")) {
    throw new Error(
      "Legacy .xls files are not supported. Please save as .xlsx and upload again.",
    );
  }

  throw new Error("Unsupported file type. Upload .csv, .xlsx, or .xlsm.");
}

async function fetchWeatherTimeline(location, startDate, endDate, apiKey) {
  const encodedLocation = encodeURIComponent(location);
  const url =
    `${VC_BASE_URL}/${encodedLocation}/${startDate}/${endDate}` +
    `?unitGroup=us&include=days` +
    `&elements=datetime,tempmax,tempmin,precip,snow,snowdepth,conditions` +
    `&key=${apiKey}&contentType=json`;

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Weather timeline failed for ${location} (${response.status}): ${text.slice(
        0,
        200,
      )}`,
    );
  }

  const payload = await response.json();
  const days = Array.isArray(payload.days) ? payload.days : [];
  const byDate = new Map();
  for (const day of days) {
    if (!day?.datetime) continue;
    byDate.set(day.datetime, {
      tempmax: toNumber(day.tempmax),
      tempmin: toNumber(day.tempmin),
      precip: toNumber(day.precip) ?? 0,
      snow: toNumber(day.snow) ?? 0,
      snowdepth: toNumber(day.snowdepth) ?? 0,
      conditions: day.conditions || null,
    });
  }

  return byDate;
}

function buildTimingSignal(rows) {
  const withWeather = rows.filter((row) => row.weather);
  if (!withWeather.length) {
    return "Insufficient weather data for timing guidance.";
  }

  const snowGroundRows = withWeather.filter(
    (row) => (row.weather.snow ?? 0) > 0 || (row.weather.snowdepth ?? 0) > 0,
  );
  const clearRows = withWeather.filter(
    (row) => (row.weather.snow ?? 0) <= 0 && (row.weather.snowdepth ?? 0) <= 0,
  );

  const avg = (list) =>
    list.length
      ? list.reduce((sum, row) => sum + row.totalLeads, 0) / list.length
      : null;

  const avgSnow = avg(snowGroundRows);
  const avgClear = avg(clearRows);

  if (avgSnow !== null && avgClear !== null) {
    if (avgSnow < avgClear * 0.75 && snowGroundRows.length >= 3) {
      return "Hold heavy direct-mail drops when snow is on the ground; response historically softens.";
    }
    if (avgSnow < avgClear * 0.9) {
      return "Use caution on snowy weeks; consider lighter cadence and stronger follow-up mix.";
    }
  }

  const coldRows = withWeather.filter((row) => (row.weather.tempmax ?? 999) < 42);
  if (coldRows.length / withWeather.length > 0.45) {
    return "Cold-weather headwinds likely; prioritize best-performing DM segments and delay lower-intent segments.";
  }

  return "Conditions appear favorable for normal direct-mail cadence.";
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "File is required. Upload a CSV or XLSX file." },
        { status: 400 },
      );
    }

    const fallbackMarket =
      String(formData.get("fallbackMarket") || "").trim() || "Unknown Market";
    const dateColumnInput = String(formData.get("dateColumn") || "").trim();
    const channelColumnInput = String(formData.get("channelColumn") || "").trim();
    const marketColumnInput = String(formData.get("marketColumn") || "").trim();

    const { headers, rows } = await parseRowsFromFile(file);
    if (!rows.length) {
      return NextResponse.json(
        {
          error:
            "No data rows found in the uploaded file. Ensure the first row is headers and at least one data row exists.",
        },
        { status: 400 },
      );
    }

    const dateColumn = chooseColumn(headers, dateColumnInput, DEFAULT_DATE_CANDIDATES);
    if (!dateColumn) {
      return NextResponse.json(
        {
          error:
            "Unable to identify a date column. Set Date Column manually (e.g., EstimateRequestedDate).",
          availableColumns: headers,
        },
        { status: 400 },
      );
    }

    const channelColumn = chooseColumn(
      headers,
      channelColumnInput,
      DEFAULT_CHANNEL_CANDIDATES,
    );
    const marketColumn = chooseColumn(
      headers,
      marketColumnInput,
      DEFAULT_MARKET_CANDIDATES,
    );

    const dailyMap = new Map();
    const channelTotals = new Map();
    let validRows = 0;
    let droppedRows = 0;
    let directMailTotal = 0;

    for (const row of rows) {
      const date = normalizeDate(row[dateColumn]);
      if (!date) {
        droppedRows += 1;
        continue;
      }

      const channel = toCleanString(
        channelColumn ? row[channelColumn] : null,
        "Unknown",
      );
      const market = toCleanString(
        marketColumn ? row[marketColumn] : null,
        fallbackMarket,
      );

      const key = `${market}|||${date}`;
      const current =
        dailyMap.get(key) ||
        ({
          market,
          date,
          totalLeads: 0,
          directMailLeads: 0,
          channels: new Map(),
        });

      current.totalLeads += 1;
      current.channels.set(channel, (current.channels.get(channel) || 0) + 1);
      channelTotals.set(channel, (channelTotals.get(channel) || 0) + 1);

      if (isDirectMailChannel(channel)) {
        current.directMailLeads += 1;
        directMailTotal += 1;
      }

      dailyMap.set(key, current);
      validRows += 1;
    }

    const aggregated = [...dailyMap.values()]
      .map((entry) => ({
        market: entry.market,
        date: entry.date,
        totalLeads: entry.totalLeads,
        directMailLeads: entry.directMailLeads,
        directMailPct: entry.totalLeads
          ? (entry.directMailLeads / entry.totalLeads) * 100
          : 0,
        channels: toSortedCounts(entry.channels, "channel"),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const warnings = [];
    let weatherErrors = [];
    const weatherByMarket = new Map();

    const weatherApiKey = process.env.VISUAL_CROSSING_API_KEY;
    if (weatherApiKey) {
      const marketRange = new Map();
      for (const row of aggregated) {
        const existing = marketRange.get(row.market);
        if (!existing) {
          marketRange.set(row.market, { start: row.date, end: row.date });
          continue;
        }

        if (row.date < existing.start) existing.start = row.date;
        if (row.date > existing.end) existing.end = row.date;
      }

      const weatherPromises = [...marketRange.entries()].map(
        async ([market, range]) => {
          try {
            const byDate = await fetchWeatherTimeline(
              market,
              range.start,
              range.end,
              weatherApiKey,
            );
            weatherByMarket.set(market, byDate);
          } catch (error) {
            weatherErrors.push(error.message || `Weather lookup failed for ${market}.`);
          }
        },
      );

      await Promise.all(weatherPromises);
    } else {
      warnings.push(
        "VISUAL_CROSSING_API_KEY is missing, so uploaded leads were analyzed without weather joins.",
      );
    }

    const joinedDaily = aggregated.map((row) => {
      const weather = weatherByMarket.get(row.market)?.get(row.date) || null;
      return {
        ...row,
        weather,
      };
    });

    const marketSummaryMap = new Map();
    for (const row of joinedDaily) {
      const existing =
        marketSummaryMap.get(row.market) ||
        ({
          market: row.market,
          totalLeads: 0,
          directMailLeads: 0,
          days: 0,
          rows: [],
        });

      existing.totalLeads += row.totalLeads;
      existing.directMailLeads += row.directMailLeads;
      existing.days += 1;
      existing.rows.push(row);
      marketSummaryMap.set(row.market, existing);
    }

    const markets = [...marketSummaryMap.values()]
      .map((entry) => {
        const sortedDates = entry.rows.map((row) => row.date).sort();
        const timingSignal = buildTimingSignal(entry.rows);
        return {
          market: entry.market,
          totalLeads: entry.totalLeads,
          directMailLeads: entry.directMailLeads,
          directMailPct: entry.totalLeads
            ? (entry.directMailLeads / entry.totalLeads) * 100
            : 0,
          days: entry.days,
          dateRange: {
            start: sortedDates[0] || null,
            end: sortedDates[sortedDates.length - 1] || null,
          },
          timingSignal,
        };
      })
      .sort((a, b) => b.totalLeads - a.totalLeads);

    const dateValues = joinedDaily.map((item) => item.date).sort();
    const response = {
      uploadedFile: String(file.name || "uploaded-file"),
      rowsParsed: rows.length,
      validRows,
      droppedRows,
      columnsDetected: headers,
      mapping: {
        dateColumn,
        channelColumn: channelColumn || null,
        marketColumn: marketColumn || null,
        fallbackMarket,
      },
      dateRange: {
        start: dateValues[0] || null,
        end: dateValues[dateValues.length - 1] || null,
      },
      totals: {
        totalLeads: validRows,
        directMailLeads: directMailTotal,
        directMailPct: validRows ? (directMailTotal / validRows) * 100 : 0,
      },
      topChannels: toSortedCounts(channelTotals, "channel").slice(0, 12),
      markets,
      daily: joinedDaily
        .slice()
        .sort((a, b) => {
          if (a.date === b.date) return a.market.localeCompare(b.market);
          return a.date < b.date ? 1 : -1;
        })
        .slice(0, 300),
      warnings: [...warnings, ...weatherErrors],
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Upload analysis failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
