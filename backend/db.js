import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Heuristica: que modo SSL probar primero. No es definitivo, initDb prueba ambos.
function preferSSL(url) {
  if (!url) return false;
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  if (/\.railway\.internal/.test(url)) return false;
  if (/sslmode=disable/.test(url)) return false;
  return true;
}

// pool se asigna en initDb (binding vivo: los importadores ven el valor actualizado).
export let pool = null;

function buildPool(useSSL) {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSSL ? { rejectUnauthorized: false } : false,
    max: 10,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5000,
    idleTimeoutMillis: 30 * 60 * 1000,
  });
}

// Conecta probando AMBOS modos SSL (on/off), con reintentos. Un "read ECONNRESET" suele
// significar desajuste de SSL: el server resetea si el cliente pide SSL y no lo soporta,
// o viceversa. Probando los dos modos evitamos tener que adivinar como esta Railway.
export async function initDb(maxAttempts = 12) {
  const first = preferSSL(process.env.DATABASE_URL);
  const modes = [first, !first];
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const useSSL of modes) {
      const candidate = buildPool(useSSL);
      try {
        await candidate.query('SELECT 1');
        pool = candidate;
        console.log(`[db] conectado (ssl=${useSSL}) en intento ${attempt}`);
        return;
      } catch (e) {
        lastErr = e;
        await candidate.end().catch(() => {});
      }
    }
    console.warn(`[db] intento ${attempt}/${maxAttempts} fallo (${lastErr?.code || lastErr?.message}); reintentando...`);
    await sleep(Math.min(1000 * attempt, 5000));
  }
  throw lastErr;
}

// Ping periodico para que el proxy/red no cierre la conexion por inactividad.
let _pingInterval = null;
export function startPoolKeepAlive() {
  if (_pingInterval) return;
  _pingInterval = setInterval(async () => {
    try { await pool?.query('SELECT 1'); }
    catch (e) { console.warn('[db] keepalive ping failed:', e.message); }
  }, 4 * 60 * 1000);
  _pingInterval.unref?.();
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
