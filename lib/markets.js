import path from "node:path";
import { readFile } from "node:fs/promises";
import { parse as parseCsv } from "csv-parse/sync";

const GMB_CSV_PATH = path.join(process.cwd(), "GMB Locations.csv");
const MARKETS_JSON_PATH = path.join(process.cwd(), "data", "markets.json");

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function buildMarketFromCsvRow(row) {
  const locality = normalizeText(row.Locality || row.locality);
  const adminArea = normalizeText(
    row["Administrative area"] || row.administrativeArea || row.state,
  );
  const country = normalizeText(row["Country / Region"] || row.country || "US");
  const postalCode = normalizeText(row["Postal code"] || row.postalCode);

  if (!locality || !adminArea) {
    return null;
  }

  const name = `${locality},${adminArea}`;
  return {
    id: slugify(`${locality}-${adminArea}`),
    name,
    label: `${locality}, ${adminArea}`,
    state: adminArea,
    country,
    postalCode: postalCode || null,
  };
}

async function loadMarketsFromCsv() {
  try {
    const raw = await readFile(GMB_CSV_PATH, "utf8");
    const rows = parseCsv(raw, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
    });

    const seen = new Set();
    const markets = [];

    for (const row of rows) {
      const market = buildMarketFromCsvRow(row);
      if (!market) continue;

      const key = market.name.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      markets.push(market);
    }

    return {
      source: "GMB Locations.csv",
      updatedAt: null,
      markets,
    };
  } catch {
    return null;
  }
}

async function loadMarketsFromJson() {
  const raw = await readFile(MARKETS_JSON_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const markets = Array.isArray(parsed.markets) ? parsed.markets : [];

  return {
    source: "data/markets.json",
    updatedAt: parsed.updatedAt || null,
    markets,
  };
}

export async function loadMarketsConfig() {
  const csvConfig = await loadMarketsFromCsv();
  if (csvConfig && csvConfig.markets.length) {
    return csvConfig;
  }

  return loadMarketsFromJson();
}
