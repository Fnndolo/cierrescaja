import express from 'express';
import multer from 'multer';
import { query } from '../db.js';
import { ensureClosingFolder, uploadFile, deleteFile } from '../services/googleDrive.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB por foto
});

function fechaToString(fecha) {
  return fecha.toISOString ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10);
}

async function getClosing(id) {
  const r = await query('SELECT * FROM closings WHERE id = $1', [id]);
  return r.rows[0];
}

function extOf(originalname, fallback = 'jpg') {
  const m = String(originalname || '').match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : fallback;
}

// POST /api/uploads/closings/:id/closing-photo  (foto o archivo del cierre del turno)
// Si el cierre ya tenia un archivo de cierre subido, lo borra de Drive antes de subir el nuevo
// para que no queden huerfanos.
router.post('/closings/:id/closing-photo', upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'falta el archivo "photo"' });
    const closing = await getClosing(req.params.id);
    if (!closing) return res.status(404).json({ error: 'cierre no encontrado' });

    // Borrar el anterior si existe
    if (closing.drive_closing_photo_id) {
      try { await deleteFile(closing.drive_closing_photo_id); }
      catch (e) { /* ya no existe en Drive, seguir */ }
    }

    const fechaStr = fechaToString(closing.fecha);
    const folderId = await ensureClosingFolder({ sede: closing.sede, date: fechaStr, kind: 'cierre' });
    const uploaded = await uploadFile({
      folderId,
      name: `cierre-turno-${fechaStr}.${extOf(req.file.originalname)}`,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
    });
    await query(
      `UPDATE closings SET drive_closing_photo_id = $1, drive_folder_id = COALESCE(drive_folder_id, $2), updated_at = NOW() WHERE id = $3`,
      [uploaded.id, folderId, req.params.id]
    );
    res.json({ ok: true, file: uploaded, folderId });
  } catch (err) { next(err); }
});

// POST /api/uploads/closings/:id/comprobantes
// Sube N fotos en una sola peticion (multipart, campo "photos" repetido).
router.post('/closings/:id/comprobantes', upload.array('photos', 30), async (req, res, next) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: 'envia al menos una foto en "photos"' });
    const closing = await getClosing(req.params.id);
    if (!closing) return res.status(404).json({ error: 'cierre no encontrado' });

    const fechaStr = fechaToString(closing.fecha);
    const folderId = await ensureClosingFolder({ sede: closing.sede, date: fechaStr, kind: 'gastos' });

    // Cuantas fotos ya hay en este cierre? para nombrar consecutivo
    const existing = Array.isArray(closing.photos) ? closing.photos : [];
    let nextIndex = existing.length + 1;

    const uploadedItems = [];
    for (const f of files) {
      const name = `comprobante-${String(nextIndex).padStart(2, '0')}-${Date.now()}.${extOf(f.originalname)}`;
      const u = await uploadFile({
        folderId,
        name,
        mimeType: f.mimetype,
        buffer: f.buffer,
      });
      uploadedItems.push({
        drive_file_id: u.id,
        name: u.name,
        web_view_link: u.webViewLink || null,
        uploaded_at: new Date().toISOString(),
      });
      nextIndex++;
    }

    const newPhotos = [...existing, ...uploadedItems];
    await query(
      `UPDATE closings SET photos = $1, drive_folder_id = COALESCE(drive_folder_id, $2), updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(newPhotos), folderId, req.params.id]
    );
    res.json({ ok: true, added: uploadedItems, photos: newPhotos });
  } catch (err) { next(err); }
});

// DELETE /api/uploads/closings/:id/comprobantes/:driveFileId
// Borra una foto del cierre (Drive + DB).
router.delete('/closings/:id/comprobantes/:driveFileId', async (req, res, next) => {
  try {
    const closing = await getClosing(req.params.id);
    if (!closing) return res.status(404).json({ error: 'cierre no encontrado' });
    const fileId = req.params.driveFileId;
    const existing = Array.isArray(closing.photos) ? closing.photos : [];
    const next = existing.filter((p) => p.drive_file_id !== fileId);
    if (next.length === existing.length) return res.status(404).json({ error: 'foto no encontrada en el cierre' });

    try { await deleteFile(fileId); } catch (e) { /* ya no existe en Drive, seguir */ }
    await query(`UPDATE closings SET photos = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(next), req.params.id]);
    res.json({ ok: true, photos: next });
  } catch (err) { next(err); }
});

// POST /api/uploads/closings/:id/alegra-file  (Excel/CSV descargado de Alegra, opcional)
router.post('/closings/:id/alegra-file', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'falta el archivo "file"' });
    const closing = await getClosing(req.params.id);
    if (!closing) return res.status(404).json({ error: 'cierre no encontrado' });

    const fechaStr = fechaToString(closing.fecha);
    const folderId = await ensureClosingFolder({ sede: closing.sede, date: fechaStr, kind: 'cierre' });
    const uploaded = await uploadFile({
      folderId,
      name: `alegra-${fechaStr}.${extOf(req.file.originalname, 'xlsx')}`,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
    });
    res.json({ ok: true, file: uploaded });
  } catch (err) { next(err); }
});

export default router;
