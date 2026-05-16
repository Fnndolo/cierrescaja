import express from 'express';
import { dailySummary } from '../services/alegraClient.js';
import { getAllTotals } from '../services/googleSheets.js';

const router = express.Router();

// GET /api/reconciliation?date=YYYY-MM-DD&sede=...
// Compara los totales por categoria en Alegra contra los totales en la hoja de comprobantes.
//
// Categorias y cuentas Alegra incluidas (allowlist):
//   - transferencia: BANCOLOMBIA*, NU BANK, NEQUI*, DAVIPLATA*
//   - datafono:      DATAFONO BOLD
//   - credito:       SUMAS PAY, BANCO DE BOGOTA*, ADDI TIENDA FISICA
// Excluidas siempre (no se cuentan en ninguna categoria):
//   *MARKETPLACE*, *ADELANTO*, *KREDIYA*
router.get('/', async (req, res, next) => {
  try {
    const { date, sede } = req.query;
    if (!date || !sede) return res.status(400).json({ error: 'falta date o sede' });

    const [alegra, sheets] = await Promise.all([
      dailySummary({ date, sede }),
      getAllTotals(date, sede),
    ]);

    const m = alegra.porMetodo;
    const s = sheets.tabs;
    const sumSafe = (...vals) => vals.reduce((a, b) => a + (Number(b) || 0), 0);

    const categorias = [
      {
        clave: 'transferencias',
        label: 'Transferencias',
        alegra: m.transferencia,
        comprobantes: s.TRANSFERENCIAS?.total || 0,
        detalle_alegra: ['Bancolombia, Nequi, Daviplata, Nu Bank'],
        detalle_comprobantes: ['TRANSFERENCIAS'],
      },
      {
        clave: 'datafono',
        label: 'Datafono BOLD',
        alegra: m.datafono,
        comprobantes: s.BOLD?.total || 0,
        detalle_alegra: ['DATAFONO BOLD'],
        detalle_comprobantes: ['BOLD'],
      },
      {
        clave: 'credito',
        label: 'Credito directo (Addi/BDB/SU+PAY/Mercado Pago)',
        alegra: m.credito,
        comprobantes: sumSafe(s.ADDI?.total, s.BDB?.total, s['SU+PAY']?.total, s.MERCADOPAGO?.total),
        detalle_alegra: ['SUMAS PAY', 'BANCO DE BOGOTA', 'ADDI TIENDA FISICA', 'MERCADO PAGO'],
        detalle_comprobantes: ['ADDI', 'BDB', 'SU+PAY', 'MERCADOPAGO'],
      },
      {
        clave: 'efectivo',
        label: 'Efectivo (Alegra)',
        alegra: m.efectivo,
        comprobantes: null,
        nota: 'Comparar manualmente contra el conteo fisico de billetes y monedas',
      },
    ];

    for (const c of categorias) {
      if (c.comprobantes == null) { c.diff = 0; c.status = 'info'; continue; }
      c.diff = Number(c.comprobantes) - Number(c.alegra);
      const abs = Math.abs(c.diff);
      if (abs < 1) c.status = 'ok';
      else if (c.diff > 0) c.status = 'comprobantes_mayor';
      else c.status = 'alegra_mayor';
    }

    res.json({
      date,
      sede,
      alegra: {
        totalIngresos: alegra.totalIngresos,
        totalEgresos: alegra.totalEgresos,
        porMetodo: alegra.porMetodo,
        porCuenta: alegra.porCuenta, // para diagnosticar que cuentas estan sumando
      },
      comprobantes: {
        tabs: sheets.tabs,
        grandTotal: sheets.grandTotal,
      },
      categorias,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
