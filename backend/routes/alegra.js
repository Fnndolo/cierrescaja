import express from 'express';
import { dailySummary, prefillFromAlegra } from '../services/alegraClient.js';

const router = express.Router();

router.get('/daily-summary', async (req, res, next) => {
  try {
    const { date, sede, force } = req.query;
    if (!date) return res.status(400).json({ error: 'falta date' });
    const summary = await dailySummary({ date, sede, force: force === 'true' });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Sugerencia para auto-llenar el formulario con datos de Alegra.
// ?force=true bypassa la cache (uso del boton manual "Refrescar desde Alegra").
router.get('/prefill', async (req, res, next) => {
  try {
    const { date, sede, force } = req.query;
    if (!date || !sede) return res.status(400).json({ error: 'falta date o sede' });
    const data = await prefillFromAlegra({ date, sede, force: force === 'true' });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
