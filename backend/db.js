import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Railway Postgres NO usa SSL en su red interna (postgres.railway.internal) ni en local.
// Solo el proxy publico (*.proxy.rlwy.net) lo soporta. Forzar SSL contra un server que no
// lo ofrece causa "read ECONNRESET" al conectar. Por eso detectamos cuando NO usar SSL.
function shouldUseSSL(url) {
  if (!url) return false;
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  if (/\.railway\.internal/.test(url)) return false;   // red interna de Railway
  if (/sslmode=disable/.test(url)) return false;
  return true; // conexiones externas (proxy publico u otros hosts)
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSSL(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
  max: 10,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5000,
  idleTimeoutMillis: 30 * 60 * 1000, // mantener idle hasta 30 min antes de cerrar
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Espera a que la DB acepte conexiones, reintentando ante ECONNRESET o arranque tardio
// (tipico cuando el contenedor de Postgres aun esta levantando).
export async function waitForDb(maxAttempts = 12) {
  let lastErr;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await pool.query('SELECT 1');
      if (i > 1) console.log(`[db] conectado en intento ${i}`);
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`[db] intento ${i}/${maxAttempts} fallo (${e.code || e.message}); reintentando...`);
      await sleep(Math.min(1000 * i, 5000));
    }
  }
  throw lastErr;
}

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
