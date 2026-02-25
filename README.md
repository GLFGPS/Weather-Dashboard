# Weather Dashboard (Internal)

This repository now runs as a **Next.js** app for secure server-side API access.

## Why it was changed

The original project was static HTML/JS with API keys in frontend code.  
For production/internal use, secrets should stay server-side.

## Features in this baseline

- Weather endpoint proxy for Visual Crossing (`/api/weather`)
- OpenAI conversational endpoint (`/api/chat`)
- 2022 workbook summary endpoint (`/api/analysis/seed-2022`)
- Dashboard UI with:
  - quick lookback windows
  - multi-location selection
  - same-day historical ranking
  - sample direct-mail + snow impact context from 2022 data

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

## Legacy files

The original static files are still present (`index.html`, `script.js`, `styles.css`) for reference while migration continues.
