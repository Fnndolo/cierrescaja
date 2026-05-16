import './env.js';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMigrations, pool, startPoolKeepAlive } from './db.js';
import { SEDES } from './config.js';
import { startAlegraPrefetcher, warmupTodayForSedes } from './services/alegraClient.js';
import closingsRouter from './routes/closings.js';
import alegraRouter from './routes/alegra.js';
import comprobantesRouter from './routes/comprobantes.js';
import reconciliationRouter from './routes/reconciliation.js';
import uploadsRouter from './routes/uploads.js';
import photosRouter from './routes/photos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) => {
  res.json({ sedes: SEDES });
});

app.use('/api/closings', closingsRouter);
app.use('/api/alegra', alegraRouter);
app.use('/api/comprobantes', comprobantesRouter);
app.use('/api/reconciliation', reconciliationRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/photos', photosRouter);

const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
const indexHtml = path.join(frontendDist, 'index.html');
if (fs.existsSync(indexHtml)) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(indexHtml);
  });
  console.log('[frontend] sirviendo build desde', frontendDist);
}

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

async function start() {
  try {
    if (process.env.DATABASE_URL) {
      await runMigrations();
      console.log('[db] migraciones aplicadas');
      // Warm-up: establece una conexion del pool antes de aceptar requests
      await pool.query('SELECT 1');
      console.log('[db] pool caliente');
      startPoolKeepAlive();
    } else {
      console.warn('[db] DATABASE_URL no configurada, saltando migraciones');
    }
    app.listen(PORT, () => {
      console.log(`[backend] escuchando en puerto ${PORT}`);
      // Precargar Alegra para hoy en todas las sedes (no bloquea el arranque)
      warmupTodayForSedes(SEDES);
      // Mantener cache fresca refrescando en background lo accedido recientemente
      startAlegraPrefetcher();
    });
  } catch (err) {
    console.error('[backend] fallo al iniciar:', err);
    process.exit(1);
  }
}

start();
