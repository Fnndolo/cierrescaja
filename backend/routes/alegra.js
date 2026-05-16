import express from 'express';
import { dailySummary, prefillFromAlegra } from '../services/alegraClient.js';

const router = express.Router();

router.get('/daily-summary', async (req, res, next) => {
  try {
    const { date, sede } = req.query;
    if (!date) return res.status(400).json({ error: 'falta date' });
    const summary = await dailySummary({ date, sede });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Sugerencia para auto-llenar el formulario con datos de Alegra.
router.get('/prefill', async (req, res, next) => {
  try {
    const { date, sede } = req.query;
    if (!date || !sede) return res.status(400).json({ error: 'falta date o sede' });
    const data = await prefillFromAlegra({ date, sede });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
