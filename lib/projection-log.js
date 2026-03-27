import { dbQuery, hasDatabaseConnection } from "./db";

let schemaReady = null;

async function ensureProjectionSchema() {
  if (!hasDatabaseConnection()) return;

  if (!schemaReady) {
    schemaReady = (async () => {
      await dbQuery(`
        CREATE TABLE IF NOT EXISTS projection_log (
          forecast_date DATE NOT NULL,
          logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          projected_total INTEGER NOT NULL,
          projected_organic INTEGER,
          projected_dm INTEGER,
          actual_total INTEGER,
          actual_organic INTEGER,
          actual_dm INTEGER,
          dow TEXT,
          calendar_week INTEGER,
          season_phase TEXT,
          weather_condition TEXT,
          weather_multiplier DOUBLE PRECISION,
          dm_method TEXT,
          dm_in_home BOOLEAN DEFAULT false,
          organic_baseline INTEGER,
          dow_multiplier DOUBLE PRECISION,
          model_version TEXT DEFAULT '2026-03-27',
          notes TEXT,
          PRIMARY KEY (forecast_date, model_version)
        );
      `);

      await dbQuery(`
        CREATE INDEX IF NOT EXISTS projection_log_date_idx
        ON projection_log (forecast_date);
      `);
    })();
  }

  await schemaReady;
}

export async function logProjection({
  forecastDate,
  projectedTotal,
  projectedOrganic,
  projectedDm,
  actualTotal,
  actualOrganic,
  actualDm,
  dow,
  calendarWeek,
  seasonPhase,
  weatherCondition,
  weatherMultiplier,
  dmMethod,
  dmInHome,
  organicBaseline,
  dowMultiplier,
  notes,
}) {
  await ensureProjectionSchema();
  if (!hasDatabaseConnection()) return null;

  const modelVersion = "2026-03-27";

  await dbQuery(
    `
      INSERT INTO projection_log (
        forecast_date, projected_total, projected_organic, projected_dm,
        actual_total, actual_organic, actual_dm,
        dow, calendar_week, season_phase, weather_condition, weather_multiplier,
        dm_method, dm_in_home, organic_baseline, dow_multiplier,
        model_version, notes
      )
      VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (forecast_date, model_version)
      DO UPDATE SET
        actual_total = COALESCE(EXCLUDED.actual_total, projection_log.actual_total),
        actual_organic = COALESCE(EXCLUDED.actual_organic, projection_log.actual_organic),
        actual_dm = COALESCE(EXCLUDED.actual_dm, projection_log.actual_dm),
        logged_at = now();
    `,
    [
      forecastDate,
      projectedTotal,
      projectedOrganic ?? null,
      projectedDm ?? null,
      actualTotal ?? null,
      actualOrganic ?? null,
      actualDm ?? null,
      dow ?? null,
      calendarWeek ?? null,
      seasonPhase ?? null,
      weatherCondition ?? null,
      weatherMultiplier ?? null,
      dmMethod ?? null,
      dmInHome ?? false,
      organicBaseline ?? null,
      dowMultiplier ?? null,
      modelVersion,
      notes ?? null,
    ],
  );
}

export async function updateActuals({ forecastDate, actualTotal, actualOrganic, actualDm }) {
  await ensureProjectionSchema();
  if (!hasDatabaseConnection()) return;

  await dbQuery(
    `
      UPDATE projection_log
      SET actual_total = $2,
          actual_organic = $3,
          actual_dm = $4,
          logged_at = now()
      WHERE forecast_date = $1::date;
    `,
    [forecastDate, actualTotal, actualOrganic ?? null, actualDm ?? null],
  );
}

export async function getProjectionLog({ startDate, endDate } = {}) {
  await ensureProjectionSchema();
  if (!hasDatabaseConnection()) return [];

  let query = `
    SELECT DISTINCT ON (forecast_date)
      forecast_date::text AS date,
      projected_total,
      projected_organic,
      projected_dm,
      actual_total,
      actual_organic,
      actual_dm,
      CASE WHEN actual_total IS NOT NULL
        THEN actual_total - projected_total
        ELSE NULL
      END AS error,
      CASE WHEN actual_total IS NOT NULL AND projected_total > 0
        THEN ROUND(((actual_total - projected_total)::numeric / projected_total) * 100, 1)
        ELSE NULL
      END AS error_pct,
      dow,
      calendar_week,
      season_phase,
      weather_condition,
      weather_multiplier,
      dm_method,
      dm_in_home,
      organic_baseline,
      dow_multiplier,
      model_version,
      notes,
      logged_at
    FROM projection_log
  `;

  const conditions = [];
  const params = [];
  if (startDate) {
    params.push(startDate);
    conditions.push(`forecast_date >= $${params.length}::date`);
  }
  if (endDate) {
    params.push(endDate);
    conditions.push(`forecast_date <= $${params.length}::date`);
  }

  if (conditions.length) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += ` ORDER BY forecast_date ASC, model_version ASC;`;

  const result = await dbQuery(query, params);
  return result.rows;
}
