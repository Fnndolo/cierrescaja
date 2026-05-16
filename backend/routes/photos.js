import express from 'express';
import { getDrive } from '../services/googleAuth.js';

const router = express.Router();

// GET /api/photos/:fileId
// Proxea el contenido del archivo en Drive usando nuestras credenciales OAuth,
// para que se vea desde cualquier navegador sin que el usuario tenga que estar
// logueado con la cuenta dueña del Drive.
router.get('/:fileId', async (req, res, next) => {
  try {
    const drive = getDrive();
    const meta = await drive.files.get({
      fileId: req.params.fileId,
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    });
    const mime = meta.data.mimeType || 'application/octet-stream';

    const stream = await drive.files.get(
      { fileId: req.params.fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.data.on('error', (err) => {
      if (!res.headersSent) res.status(500);
      res.end();
      console.error('[photos] stream error:', err.message);
    });
    stream.data.pipe(res);
  } catch (err) {
    if (err?.code === 404 || err?.response?.status === 404) {
      return res.status(404).end();
    }
    next(err);
  }
});

export default router;
