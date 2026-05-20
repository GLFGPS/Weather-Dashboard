# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Single Next.js 16 app (React 19) — an internal Weather & Lead Analytics Dashboard for a lawn care company. No monorepo, no Docker, no TypeScript.

### Running the dev server

```bash
npm run dev        # starts on http://localhost:3000
```

### Lint

`next lint` was removed in Next.js 16. The `npm run lint` script in `package.json` references it but does **not** work. There is no ESLint config in this repo. Skip lint for now.

### Build

```bash
npm run build      # production build (Turbopack)
```

### Required environment variables

Create `.env.local` from `.env.example`. Key variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `POSTGRES_URL` | Yes (for lead/weather data) | Local: `postgresql://weatherapp:weatherapp@localhost:5432/weather_dashboard` |
| `VISUAL_CROSSING_API_KEY` | Yes (weather endpoints) | Free tier available at visualcrossing.com |
| `OPENAI_API_KEY` | Optional | Only for AI Strategy Assistant chat |
| `OPENAI_MODEL` | Optional | Default: `gpt-4.1-mini` |

### Local PostgreSQL setup

PostgreSQL must be running for lead data and weather caching features. Tables are auto-created on first access.

```bash
sudo pg_ctlcluster 16 main start
```

If starting fresh:
```bash
sudo -u postgres psql -c "CREATE USER weatherapp WITH PASSWORD 'weatherapp' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE weather_dashboard OWNER weatherapp;"
```

### Gotchas

- The app gracefully handles missing `POSTGRES_URL` — pages render but lead/projection data shows empty.
- Without a valid `VISUAL_CROSSING_API_KEY`, weather endpoints return 500 errors with a clear message. The UI still renders with error banners.
- The `app/page.js` is a large single-file React component (~2000 lines). All dashboard UI lives there.
- CSV lead files in repo root (2021–2026) are auto-ingested into Postgres on first access to `/api/leads/overview`.
- Market list comes from `GMB Locations.csv` (repo root) or `data/markets.json` fallback.
