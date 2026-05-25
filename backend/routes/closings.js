import express from 'express';
import { query } from '../db.js';
import { SEDES } from '../config.js';
import { ensureClosingFolder, uploadFile } from '../services/googleDrive.js';
import { fillArqueo } from '../services/excelFiller.js';
import { buildTransactionsReport } from '../services/transactionsReport.js';
import { getEgresosDelDia } from '../services/alegraClient.js';
import { renderPrintPage } from '../services/printRenderer.js';
import { emitClosingChange } from '../services/eventBus.js';

const router = express.Router();

function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Hora actual en zona horaria de Colombia (HH:MM:SS), independientemente del TZ del servidor.
function currentColombiaTime() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value || '00';
  // Intl puede devolver "24" para medianoche en algunos motores
  const hh = get('hour') === '24' ? '00' : get('hour');
  return `${hh}:${get('minute')}:${get('second')}`;
}

// Suma billetes y monedas de un conteo => total efectivo arqueado.
function totalArqueoFromConteo(conteo) {
  if (!conteo || typeof conteo !== 'object') return 0;
  let total = 0;
  for (const group of ['billetes', 'monedas']) {
    const g = conteo[group] || {};
    for (const [denom, cant] of Object.entries(g)) {
      total += (Number(cant) || 0) * (Number(denom) || 0);
    }
  }
  return total;
}

// Busca el cierre finalizado mas reciente de la misma sede ANTES de la fecha dada,
// y devuelve su total de arqueo (cash que quedo en caja al final de ese dia).
async function findPreviousArqueo(sede, fecha) {
  const r = await query(
    `SELECT fecha, conteo FROM closings
     WHERE sede = $1 AND fecha < $2 AND estado = 'finalizado'
     ORDER BY fecha DESC LIMIT 1`,
    [sede, fecha]
  );
  if (!r.rows[0]) return null;
  return {
    fecha: r.rows[0].fecha,
    total: totalArqueoFromConteo(r.rows[0].conteo),
  };
}

// GET /api/closings?sede=&from=&to=
router.get('/', async (req, res, next) => {
  try {
    const { sede, from, to } = req.query;
    const params = [];
    const where = [];
    if (sede) { params.push(sede); where.push(`sede = $${params.length}`); }
    if (from) { params.push(from); where.push(`fecha >= $${params.length}`); }
    if (to)   { params.push(to);   where.push(`fecha <= $${params.length}`); }
    const sql = `SELECT id, sede, fecha, hora, responsable, estado, drive_excel_id, finalized_at, created_at
                 FROM closings
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY fecha DESC, sede ASC LIMIT 200`;
    const r = await query(sql, params);
    res.json({ items: r.rows });
  } catch (err) { next(err); }
});

// POST /api/closings  body: { sede, fecha }
// idempotente: si ya existe (sede, fecha), retorna el existente.
router.post('/', async (req, res, next) => {
  try {
    const { sede, fecha } = req.body || {};
    if (!sede || !SEDES.includes(sede)) {
      return res.status(400).json({ error: 'sede invalida' });
    }
    if (!isValidDate(fecha)) {
      return res.status(400).json({ error: 'fecha invalida (YYYY-MM-DD)' });
    }
    const insert = `INSERT INTO closings (sede, fecha)
                    VALUES ($1, $2)
                    ON CONFLICT (sede, fecha) DO UPDATE SET updated_at = NOW()
                    RETURNING *`;
    const r = await query(insert, [sede, fecha]);
    const closing = r.rows[0];

    // Si el cierre acaba de crearse (esta vacio) buscamos el arqueo de ayer para sugerir saldo anterior.
    const isFresh = Number(closing.saldo_anterior) === 0
                  && Object.keys(closing.entradas || {}).length === 0
                  && Object.keys(closing.conteo || {}).length === 0;
    let saldo_anterior_sugerido = null;
    if (isFresh) {
      const prev = await findPreviousArqueo(sede, fecha);
      if (prev) saldo_anterior_sugerido = { fuente: 'db', fecha: prev.fecha, total: prev.total };
    }

    res.status(201).json({ ...closing, saldo_anterior_sugerido });
  } catch (err) { next(err); }
});

// GET /api/closings/:id
router.get('/:id', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM closings WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'no encontrado' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// GET /api/closings/by/:sede/:fecha
router.get('/by/:sede/:fecha', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM closings WHERE sede = $1 AND fecha = $2', [req.params.sede, req.params.fecha]);
    if (!r.rows[0]) return res.json(null);
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/closings/:id  body: campos a actualizar
const ALLOWED_FIELDS = ['hora', 'responsable', 'saldo_anterior', 'entradas', 'gastos', 'conteo'];
const JSON_FIELDS = new Set(['entradas', 'gastos', 'conteo']);
router.patch('/:id', async (req, res, next) => {
  try {
    const fields = [];
    const params = [];
    for (const k of ALLOWED_FIELDS) {
      if (req.body[k] === undefined) continue;
      let val = req.body[k];
      if (JSON_FIELDS.has(k)) {
        val = JSON.stringify(val);
      } else if (val === '' || val === undefined) {
        // Postgres rechaza string vacio en columnas TIME / NUMERIC. Convertir a NULL.
        val = null;
      }
      params.push(val);
      fields.push(`${k} = $${params.length}`);
    }
    if (!fields.length) return res.status(400).json({ error: 'sin campos' });
    fields.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const sql = `UPDATE closings SET ${fields.join(', ')} WHERE id = $${params.length} AND estado = 'borrador' RETURNING *`;
    const r = await query(sql, params);
    if (!r.rows[0]) return res.status(400).json({ error: 'cierre finalizado o inexistente' });
    emitClosingChange(req.params.id, 'patch');
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/closings/:id/finalize
router.post('/:id/finalize', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM closings WHERE id = $1', [req.params.id]);
    const closing = r.rows[0];
    if (!closing) return res.status(404).json({ error: 'no encontrado' });
    if (closing.estado === 'finalizado') {
      return res.status(400).json({ error: 'ya esta finalizado' });
    }

    // Si el usuario no ingreso hora manualmente, registramos la hora actual del cierre
    if (!closing.hora) {
      const horaAuto = currentColombiaTime();
      await query('UPDATE closings SET hora = $1 WHERE id = $2', [horaAuto, closing.id]);
      closing.hora = horaAuto;
    }

    const fechaStr = closing.fecha?.toISOString
      ? closing.fecha.toISOString().slice(0, 10)
      : String(closing.fecha).slice(0, 10);
    const folderId = await ensureClosingFolder({ sede: closing.sede, date: fechaStr, kind: 'cierre' });
    const buffer = await fillArqueo({
      ...closing,
      fecha: fechaStr,
    });
    const safeSede = closing.sede.replace(/[^\w\s-]/g, '').trim();
    const uploaded = await uploadFile({
      folderId,
      name: `arqueo-${safeSede}-${fechaStr}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(buffer),
    });

    // Reporte de transacciones de Alegra (replica el export oficial).
    // Si falla, no rompe la finalizacion del arqueo.
    let transUploaded = null;
    let transError = null;
    try {
      const report = await buildTransactionsReport({ sede: closing.sede, date: fechaStr });
      transUploaded = await uploadFile({
        folderId,
        name: report.filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: report.buffer,
      });
    } catch (e) {
      transError = e.message || String(e);
      console.warn('[finalize] reporte transacciones fallo:', transError);
    }

    const upd = await query(
      `UPDATE closings SET estado = 'finalizado', finalized_at = NOW(),
              drive_folder_id = $1, drive_excel_id = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [folderId, uploaded.id, req.params.id]
    );
    emitClosingChange(req.params.id, 'finalize');
    res.json({
      closing: upd.rows[0],
      drive: { folderId, excel: uploaded, transacciones: transUploaded },
      transactionsReportError: transError,
    });
  } catch (err) { next(err); }
});

// POST /api/closings/:id/reopen   (utilidad para corregir antes de Drive)
router.post('/:id/reopen', async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE closings SET estado = 'borrador', finalized_at = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'no encontrado' });
    emitClosingChange(req.params.id, 'reopen');
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// GET /api/closings/:id/print
// Devuelve una pagina HTML auto-imprimible con: foto del cierre + arqueo + transacciones.
// El navegador la abre, dispara window.print() solo y el usuario imprime todo de una vez.
router.get('/:id/print', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM closings WHERE id = $1', [req.params.id]);
    const closing = r.rows[0];
    if (!closing) return res.status(404).send('Cierre no encontrado');

    const fechaStr = closing.fecha?.toISOString
      ? closing.fecha.toISOString().slice(0, 10)
      : String(closing.fecha).slice(0, 10);

    let transacciones = [];
    try {
      const outs = await getEgresosDelDia({ sede: closing.sede, date: fechaStr });
      transacciones = (outs || []).filter((p) => {
        const t = String(p.anotation || p.observations || '');
        return !/apertura\s*de\s*turno/i.test(t) && !/cierre\s*de\s*turno/i.test(t);
      }).sort((a, b) => (Number(b.number) || 0) - (Number(a.number) || 0));
    } catch (e) {
      console.warn('[print] no pude traer transacciones:', e.message);
    }

    const html = renderPrintPage({ closing, transacciones });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) { next(err); }
});

export default router;
