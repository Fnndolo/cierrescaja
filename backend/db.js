import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const useSSL = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost');

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 10,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5000,
  idleTimeoutMillis: 30 * 60 * 1000, // mantener idle hasta 30 min antes de cerrar
});

// Ping cada 4 minutos para que el proxy de Railway no cierre la conexion por inactividad.
// Sin esto, la primera consulta tras un rato de espera tarda muchisimo en conectar.
let _pingInterval = null;
export function startPoolKeepAlive() {
  if (_pingInterval) return;
  _pingInterval = setInterval(async () => {
    try { await pool.query('SELECT 1'); }
    catch (e) { console.warn('[db] keepalive ping failed:', e.message); }
  }, 4 * 60 * 1000);
  _pingInterval.unref?.(); // no impedir que el proceso termine
}

export async function runMigrations() {
  const sqlDir = path.join(__dirname, 'sql');
  const files = (await fs.readdir(sqlDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(sqlDir, file), 'utf8');
    await pool.query(sql);
  }
}

export async function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
