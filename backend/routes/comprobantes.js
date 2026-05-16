import express from 'express';
import { getAllTotals } from '../services/googleSheets.js';

const router = express.Router();

// GET /api/comprobantes/daily-summary?date=YYYY-MM-DD&sede=...
router.get('/daily-summary', async (req, res, next) => {
  try {
    const { date, sede } = req.query;
    if (!date || !sede) return res.status(400).json({ error: 'falta date o sede' });
    const r = await getAllTotals(date, sede);
    res.json({ date, sede, ...r });
  } catch (err) {
    next(err);
  }
});

export default router;
