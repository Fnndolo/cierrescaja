// Carga .env desde varias ubicaciones posibles para soportar tanto
// ejecutar desde la raiz del proyecto como desde la carpeta backend/.
//
// Orden: la primera .env que exista gana sus claves; las siguientes solo
// agregan claves que aun no estan definidas (dotenv no sobreescribe por default).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const candidates = [
  path.join(__dirname, '.env'),               // backend/.env
  path.join(__dirname, '..', '.env'),         // project root .env
  path.resolve(process.cwd(), '.env'),        // cwd .env
];

const seen = new Set();
const loaded = [];
for (const p of candidates) {
  const resolved = path.resolve(p);
  if (seen.has(resolved)) continue;
  seen.add(resolved);
  if (fs.existsSync(resolved)) {
    dotenv.config({ path: resolved });
    loaded.push(resolved);
  }
}
if (process.env.DEBUG_ENV) {
  console.log('[env] cargado desde:', loaded.length ? loaded : '(ninguno)');
}
