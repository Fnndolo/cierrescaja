import { getSheets } from './googleAuth.js';

// Pestania -> nombre exacto de la columna que contiene el monto.
// Tomado de ConfirmadorComprobantes/bot/config.py SHEET_COLUMNS_MAP.
export const SHEET_VALUE_COLUMN = {
  BOLD: 'VALOR COMPRA',
  ADDI: 'VALOR COMPRA',
  BDB: 'VALOR COMPRA',
  'SU+PAY': 'VALOR COMPRA',
  MERCADOPAGO: 'VALOR COMPRA',
  TRANSFERENCIAS: 'VALOR PAGO',
};

export const ALL_TABS = Object.keys(SHEET_VALUE_COLUMN);

const tabCache = new Map(); // key: `${spreadsheetId}/${tab}` -> { headers, rows, fetchedAt }
const CACHE_TTL_MS = 30 * 1000; // 30s

async function fetchTab(spreadsheetId, tab) {
  const cacheKey = `${spreadsheetId}/${tab}`;
  const cached = tabCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }
  const sheets = getSheets();
  let values;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:Z`,
    });
    values = res.data.values || [];
  } catch (err) {
    if (err.code === 400 || err.message?.includes('Unable to parse range')) {
      // pestania no existe -> tratar como vacia
      values = [];
    } else {
      throw err;
    }
  }
  const [headers = [], ...rows] = values;
  const entry = { headers, rows, fetchedAt: Date.now() };
  tabCache.set(cacheKey, entry);
  return entry;
}

function parseAmount(raw) {
  if (raw == null) return 0;
  let s = String(raw).trim();
  if (!s) return 0;
  // quita simbolos
  s = s.replace(/[\s$COP]/gi, '');
  // si tiene coma como decimal (1.234,56), normaliza
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma && !hasDot) {
    // 1234,56 -> 1234.56  (decimal con coma)
    s = s.replace(',', '.');
  } else if (hasDot && !hasComma) {
    // 1.234.567 -> 1234567 (separador miles con punto, sin decimales)
    const parts = s.split('.');
    const last = parts[parts.length - 1];
    if (parts.length > 1 && last.length === 3) {
      s = parts.join('');
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
}

function parseSheetDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Formatos comunes: 2026-05-12, 12/05/2026, 12-05-2026
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = m[2].padStart(2, '0');
    let year = m[3];
    if (year.length === 2) year = '20' + year;
    return `${year}-${month}-${day}`;
  }
  // Fallback: Date parsing
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export async function sumByDateAndPos(tab, date, sede) {
  const spreadsheetId = process.env.COMPROBANTES_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('COMPROBANTES_SPREADSHEET_ID no esta configurado');
  const { headers, rows } = await fetchTab(spreadsheetId, tab);
  if (!headers.length) return { total: 0, count: 0 };

  const upper = headers.map((h) => normalize(h));
  const idxFecha = upper.indexOf('FECHA');
  const idxPos = upper.indexOf('PUNTO DE VENTA');
  const valueCol = SHEET_VALUE_COLUMN[tab];
  const idxValor = upper.indexOf(normalize(valueCol));

  if (idxFecha === -1 || idxValor === -1) {
    return { total: 0, count: 0, warning: `pestania ${tab} sin columnas FECHA o ${valueCol}` };
  }

  const targetSede = normalize(sede);
  let total = 0;
  let count = 0;
  for (const row of rows) {
    const rowFecha = parseSheetDate(row[idxFecha]);
    if (rowFecha !== date) continue;
    if (idxPos !== -1) {
      const rowSede = normalize(row[idxPos]);
      // match flexible: si la columna esta vacia, contar; si esta llena, debe contener el nombre de la sede o viceversa
      if (rowSede && targetSede && !rowSede.includes(targetSede) && !targetSede.includes(rowSede)) {
        continue;
      }
    }
    const valor = parseAmount(row[idxValor]);
    total += valor;
    count += 1;
  }
  return { total, count };
}

export async function getAllTotals(date, sede) {
  const out = {};
  let grand = 0;
  for (const tab of ALL_TABS) {
    const r = await sumByDateAndPos(tab, date, sede);
    out[tab] = r;
    grand += r.total;
  }
  return { tabs: out, grandTotal: grand };
}
