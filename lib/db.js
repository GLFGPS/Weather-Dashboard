import { Pool } from "pg";

const globalForDb = globalThis;

function getConnectionString() {
  return process.env.POSTGRES_URL || process.env.DATABASE_URL || null;
}

export function hasDatabaseConnection() {
  return Boolean(getConnectionString());
}

export function getDbPool() {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error(
      "Database connection is missing. Set POSTGRES_URL or DATABASE_URL in environment variables.",
    );
  }

  if (!globalForDb.__weatherDashboardPool) {
    globalForDb.__weatherDashboardPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  return globalForDb.__weatherDashboardPool;
}

export async function dbQuery(text, values = []) {
  const pool = getDbPool();
  return pool.query(text, values);
}
