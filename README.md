# Weather Dashboard (Internal)

This repository now runs as a **Next.js** app for secure server-side API access.

## Why it was changed

The original project was static HTML/JS with API keys in frontend code.  
For production/internal use, secrets should stay server-side.

## Features in this baseline

- Weather endpoint proxy for Visual Crossing (`/api/weather`)
- Multi-market weather radar endpoint (`/api/weather/markets`)
- OpenAI conversational endpoint (`/api/chat`)
- GitHub-backed market configuration endpoint (`/api/markets`) that prefers:
  1. `GMB Locations.csv` (if present)
  2. `data/markets.json` fallback
- Manual lead upload + aggregation endpoint (`/api/analysis/upload`)
- Dashboard UI with:
  - quick lookback windows
  - multi-location weather radar from all configured locations
  - same-day historical ranking
  - file upload analysis for historical lead exports (CSV/XLSX)

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy env vars:

   ```bash
   cp .env.example .env.local
   ```

3. Set values in `.env.local`:

   - `VISUAL_CROSSING_API_KEY`
   - `OPENAI_API_KEY`
   - optional `OPENAI_MODEL`

4. Run:

   ```bash
   npm run dev
   ```

## Vercel deployment

### Required settings

- Framework Preset: **Next.js**
- Root Directory: **./**
- Build Command: leave default (`next build`)
- Output Directory: leave default

### Required environment variables (Project Settings -> Environment Variables)

- `VISUAL_CROSSING_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, default: `gpt-4.1-mini`)

## Internal + private recommendations (no app login)

For an internal dashboard without building your own auth yet:

1. Turn on **Vercel Deployment Protection** for Preview + Production.
2. Require **team authentication** (or password protection) at the edge.
3. Restrict access to known company IP ranges if your Vercel plan supports it.
4. Keep all API keys only in Vercel env vars (never in client code).
5. Rotate keys quarterly and immediately on personnel changes.

## Market configuration (fixed list in GitHub)

Primary source (recommended):

- `GMB Locations.csv`

Expected headers:

- `Locality`
- `Administrative area`
- `Country / Region`
- `Postal code`

The app builds a location query as `Locality,Administrative area` (example: `West Chester,PA`).

Fallback source:

Edit:

- `data/markets.json`

Schema:

```json
{
  "updatedAt": "YYYY-MM-DD",
  "markets": [
    {
      "id": "west-chester-pa",
      "name": "West Chester,PA",
      "label": "West Chester, PA",
      "state": "PA",
      "region": "Southeast PA"
    }
  ]
}
```

The dashboard loads this at runtime via `/api/markets`, so market list changes are versioned in GitHub and deploy with code.

## Manual lead upload (v1)

Upload file types:

- `.csv`
- `.xlsx`
- `.xlsm`

Suggested columns:

- Date column (required): e.g. `EstimateRequestedDate`
- Channel column (optional but recommended): e.g. `ProgramSourceDescription`
- Market column (optional): e.g. `market`, `city`, `branch`

If no market column exists, the currently selected dashboard location is used as fallback.

Upload processing:

1. Parse rows from file
2. Aggregate to daily market-level lead metrics
3. Join weather metrics by market and date (Visual Crossing)
4. Return market timing signals for direct-mail planning

## Legacy files

The original static files are still present (`index.html`, `script.js`, `styles.css`) for reference while migration continues.
