// Genera el reporte de "Transacciones" (solo egresos) replicando el formato del
// export oficial de Alegra: 14 columnas, datos del dia, una fila por egreso.
//
// Se invoca en la finalizacion del cierre y el archivo se sube a la carpeta de
// Drive del dia junto con el arqueo.

import ExcelJS from 'exceljs';
import { getEgresosDelDia, getCompanyName } from './alegraClient.js';

// Columnas (en orden exacto) del export oficial de Alegra
const COLUMNS = [
  'Cuenta',
  'Fecha',
  'Número',
  'Cliente',
  'Identificación',
  'Tipo de identificación',
  'Valor',
  'Observaciones',
  'Notas',
  'Asociaciones',
  'Tipo',
  'Conciliada?',
  'Método de pago',
  'Estado',
];

function pad2(n) { return String(n).padStart(2, '0'); }

// Nombre de archivo: "Alegra - Transacciones - {COMPANY} - DD_MM_YYYY.xlsx"
export function transactionsReportFilename(company, dateISO) {
  const [y, m, d] = dateISO.slice(0, 10).split('-').map(Number);
  return `Alegra - Transacciones - ${company} - ${pad2(d)}_${pad2(m)}_${y}.xlsx`;
}

function rowFromPayment(p, dateISO) {
  // Fecha en ISO con sufijo Z, igual a como Alegra lo exporta
  const fechaISO = `${dateISO}T00:00:00.000Z`;
  return [
    p.bankAccount?.name || '',
    fechaISO,
    String(p.number ?? p.id ?? ''),
    p.client?.name || p.provider?.name || null,
    p.client?.identification || p.provider?.identification || null,
    p.client?.identificationObject?.type || p.provider?.identificationObject?.type || null,
    Number(p.amount) || 0,
    p.observations || '',
    p.anotation || null,
    p.categories?.[0]?.name || '',
    'Egreso',
    'No',
    p.paymentMethod || '',
    p.status || '',
  ];
}

// Excluye los movimientos del sistema (apertura/cierre de turno), igual que el
// reporte oficial de Alegra "Transacciones".
function isSystemTurnoEntry(p) {
  const text = String(p.anotation || p.observations || '');
  return /apertura\s*de\s*turno/i.test(text) || /cierre\s*de\s*turno/i.test(text);
}

export async function buildTransactionsReport({ sede, date }) {
  const [outs, companyName] = await Promise.all([
    getEgresosDelDia({ sede, date, force: false }),
    getCompanyName(sede),
  ]);

  const filtered = outs.filter((p) => !isSystemTurnoEntry(p));

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Worksheet');

  sheet.addRow(COLUMNS);
  // Mas reciente arriba (numero descendente), igual que Alegra
  const sorted = [...filtered].sort((a, b) => {
    const na = Number(a.number) || 0;
    const nb = Number(b.number) || 0;
    return nb - na;
  });
  for (const p of sorted) {
    sheet.addRow(rowFromPayment(p, date));
  }

  // Anchos similares al original
  sheet.getColumn(1).width = 36; // Cuenta
  sheet.getColumn(2).width = 24; // Fecha
  sheet.getColumn(7).width = 14; // Valor
  sheet.getColumn(8).width = 40; // Observaciones

  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    filename: transactionsReportFilename(companyName, date),
    count: filtered.length,
  };
}
