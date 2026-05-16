import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILLETES, MONEDAS, ENTRADAS_KEYS } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'arqueo.xlsx');

// Mapeo basado en la plantilla real (KUPOCELL).
// Las celdas que son formulas (totales, faltante, traslado) se dejan intactas y se recalculan solas.
const CELL_MAP = {
  fecha: 'C8',           // C8:D8 merged (template default =TODAY())
  hora: 'F8',            // F8:G8 merged
  sede: 'I8',
  responsable: 'C9',     // C9:I9 merged (default "ADMINISTRADOR DE CADA PUNTO DE VENTA")
  saldo_anterior: 'I12',
  entradas: {
    factura_electronica:    'I15',
    venta_factura_pos:      'I16',
    ingresos_rc:            'I17',
    anticipos_clientes:     'I18',
    otros_ingresos:         'I19',
    cuota_inicial_efectivo: 'I20',
  },
  // Gastos: filas 34-43 (10 maximo). B=Fecha, C=CP, D=Tercero (D:E merged),
  // F=Concepto (F:H merged), I=Valor. Total en I44 (formula).
  gastos: {
    firstRow: 34,
    lastRow: 43,
    cols: { fecha: 'B', cp_no: 'C', tercero: 'D', concepto: 'F', valor: 'I' },
  },
  // Conteo (filas 53-59 billetes / 53-57 monedas). Solo escribimos cantidad.
  // Las denominaciones y formulas de valor ya estan en la plantilla.
  billetes: { firstRow: 53, lastRow: 59, denomCol: 'B', countCol: 'D' },
  monedas:  { firstRow: 53, lastRow: 57, denomCol: 'F', countCol: 'H' },
};

function safeSet(sheet, addr, value) {
  if (!addr) return;
  try {
    sheet.getCell(addr).value = value;
  } catch (err) { /* ignorar */ }
}

// Reemplaza todas las celdas con formulas (incluyendo formulas compartidas) por sus
// valores calculados almacenados. Necesario antes de insertar filas: si quedan
// formulas compartidas vivas, ExcelJS lanza "Shared Formula master must exist" al guardar.
// Como reescribimos todos los totales relevantes en JS, no perdemos informacion util.
function flattenFormulas(sheet) {
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      try {
        if (cell.formula) {
          const r = cell.result;
          cell.value = (r === undefined || r === null) ? null : r;
        }
      } catch (e) { /* ignorar */ }
    });
  });
}

function sumObj(obj, keys) {
  let s = 0;
  for (const k of keys) s += Number(obj?.[k]) || 0;
  return s;
}
function sumGastos(gastos = []) {
  return gastos.reduce((acc, g) => acc + (Number(g.valor) || 0), 0);
}

// Mapa denom -> fila a partir de la plantilla, robusto al orden.
function denomRowMap(sheet, cfg) {
  const map = new Map();
  for (let r = cfg.firstRow; r <= cfg.lastRow; r++) {
    const v = Number(sheet.getCell(cfg.denomCol + r).value);
    if (v > 0) map.set(v, r);
  }
  return map;
}

export async function fillArqueo(closing) {
  if (fs.existsSync(TEMPLATE_PATH)) return fillFromTemplate(closing);
  return generateFromScratch(closing);
}

async function fillFromTemplate(closing) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  const sheet = wb.worksheets[0];

  // Convertir las formulas compartidas a valores para que duplicateRow no falle.
  // Reescribimos todos los totales abajo como literales calculados en JS.
  flattenFormulas(sheet);

  // Encabezado
  safeSet(sheet, CELL_MAP.fecha, closing.fecha);
  safeSet(sheet, CELL_MAP.hora, closing.hora || '');
  safeSet(sheet, CELL_MAP.sede, closing.sede);
  safeSet(sheet, CELL_MAP.responsable, closing.responsable || '');

  // Saldo anterior
  const saldoAnterior = Number(closing.saldo_anterior) || 0;
  safeSet(sheet, CELL_MAP.saldo_anterior, saldoAnterior);

  // Entradas
  for (const k of ENTRADAS_KEYS) {
    safeSet(sheet, CELL_MAP.entradas[k], Number(closing.entradas?.[k]) || 0);
  }

  // Gastos: si hay mas de 10 (limite de la plantilla), insertamos filas extra duplicando
  // la ultima fila base (asi mantienen bordes y celdas combinadas). Las celdas con formulas
  // que estaban abajo (totales/resumen) quedan desplazadas y las reescribimos como valores
  // literales calculados en JS.
  const gastos = closing.gastos || [];
  const baseFirst = CELL_MAP.gastos.firstRow;     // 34
  const baseLast  = CELL_MAP.gastos.lastRow;      // 43
  const baseCount = baseLast - baseFirst + 1;     // 10
  const extra = Math.max(0, gastos.length - baseCount);
  if (extra > 0) {
    // Duplica la ultima fila base `extra` veces e inserta abajo (empuja todo lo de abajo).
    sheet.duplicateRow(baseLast, extra, true);
  }
  for (let i = 0; i < gastos.length; i++) {
    const row = baseFirst + i;
    const g = gastos[i];
    safeSet(sheet, `${CELL_MAP.gastos.cols.fecha}${row}`,   g.fecha || closing.fecha);
    safeSet(sheet, `${CELL_MAP.gastos.cols.cp_no}${row}`,   g.cp_no || '');
    safeSet(sheet, `${CELL_MAP.gastos.cols.tercero}${row}`, g.tercero || '');
    safeSet(sheet, `${CELL_MAP.gastos.cols.concepto}${row}`,g.concepto || '');
    safeSet(sheet, `${CELL_MAP.gastos.cols.valor}${row}`,   Number(g.valor) || 0);
  }

  // Cantidades de conteo: las filas se desplazaron por `extra`.
  const billCfg = { ...CELL_MAP.billetes, firstRow: CELL_MAP.billetes.firstRow + extra, lastRow: CELL_MAP.billetes.lastRow + extra };
  const monCfg  = { ...CELL_MAP.monedas,  firstRow: CELL_MAP.monedas.firstRow  + extra, lastRow: CELL_MAP.monedas.lastRow  + extra };
  const billRows = denomRowMap(sheet, billCfg);
  for (const denom of BILLETES) {
    const row = billRows.get(denom);
    if (!row) continue;
    const cant = Number(closing.conteo?.billetes?.[denom]) || 0;
    safeSet(sheet, `${CELL_MAP.billetes.countCol}${row}`, cant);
    safeSet(sheet, `E${row}`, cant * denom);  // valor billete (antes =B*D)
  }
  const monRows = denomRowMap(sheet, monCfg);
  for (const denom of MONEDAS) {
    const row = monRows.get(denom);
    if (!row) continue;
    const cant = Number(closing.conteo?.monedas?.[denom]) || 0;
    safeSet(sheet, `${CELL_MAP.monedas.countCol}${row}`, cant);
    safeSet(sheet, `I${row}`, cant * denom);  // valor moneda (antes =F*H)
  }

  // Calculamos totales en JS y los escribimos como valores literales en las celdas
  // que originalmente tenian formulas (todas se desplazaron en `extra` filas).
  const totalEntradas = sumObj(closing.entradas, ENTRADAS_KEYS);
  const totalComprobantes = sumGastos(gastos);
  const totalEfectivo = saldoAnterior + totalEntradas;     // SALDO + ENTRADAS (sin salidas)
  const totalBilletes   = BILLETES.reduce((s, d) => s + (Number(closing.conteo?.billetes?.[d]) || 0) * d, 0);
  const totalMonedas    = MONEDAS.reduce((s, d)  => s + (Number(closing.conteo?.monedas?.[d])  || 0) * d, 0);
  const cantBilletes    = BILLETES.reduce((s, d) => s + (Number(closing.conteo?.billetes?.[d]) || 0), 0);
  const cantMonedas     = MONEDAS.reduce((s, d)  => s + (Number(closing.conteo?.monedas?.[d])  || 0), 0);
  const totalArqueo   = totalBilletes + totalMonedas;
  const efectivoEsperado = saldoAnterior + totalEntradas - totalComprobantes;
  const faltanteSobrante = totalArqueo - efectivoEsperado;
  const trasladoCajaGeneral = totalArqueo - totalComprobantes;

  // Posiciones desplazadas:
  safeSet(sheet, `I${21}`,            totalEntradas);            // total entradas (no se mueve)
  safeSet(sheet, `I${44 + extra}`,    totalComprobantes);        // total comprobantes de pago
  safeSet(sheet, `I${46 + extra}`,    totalComprobantes);        // total salidas del dia (= comprobantes)
  safeSet(sheet, `I${47 + extra}`,    totalEfectivo);            // total efectivo (saldo + entradas)
  safeSet(sheet, `D${60 + extra}`,    cantBilletes);             // cantidad total billetes
  safeSet(sheet, `E${60 + extra}`,    totalBilletes);            // valor total billetes (col E)
  safeSet(sheet, `H${60 + extra}`,    cantMonedas);              // cantidad total monedas
  safeSet(sheet, `I${60 + extra}`,    totalMonedas);             // valor total monedas (col I)
  safeSet(sheet, `I${61 + extra}`,    totalArqueo);              // total arqueo billetes + monedas
  // Resumen final (63-67 desplazados)
  safeSet(sheet, `I${63 + extra}`,    totalEfectivo);            // planilla ingresos
  safeSet(sheet, `I${64 + extra}`,    totalArqueo);              // arqueo
  safeSet(sheet, `I${65 + extra}`,    totalComprobantes);        // salidas diarias
  safeSet(sheet, `I${66 + extra}`,    faltanteSobrante);         // faltante/sobrante
  safeSet(sheet, `I${67 + extra}`,    trasladoCajaGeneral);      // traslado caja general

  return await wb.xlsx.writeBuffer();
}

// Layout generado cuando no hay plantilla. No es pixel-perfect pero contiene todos los datos.
async function generateFromScratch(closing) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CierresCaja';
  const sheet = wb.addWorksheet('Arqueo');

  sheet.mergeCells('A1:I1');
  sheet.getCell('A1').value = 'KUPOCELL S.A.S. - NIT: 901339881-7';
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };
  sheet.mergeCells('A2:I2');
  sheet.getCell('A2').value = 'ARQUEO DE CAJA - GESTION FINANCIERA';
  sheet.getCell('A2').alignment = { horizontal: 'center' };

  sheet.getCell('A4').value = 'FECHA';      sheet.getCell('B4').value = closing.fecha;
  sheet.getCell('C4').value = 'HORA';        sheet.getCell('D4').value = closing.hora || '';
  sheet.getCell('E4').value = 'SEDE';        sheet.getCell('F4').value = closing.sede;
  sheet.getCell('A5').value = 'RESPONSABLE'; sheet.getCell('B5').value = closing.responsable || '';

  let row = 7;
  sheet.getCell(`A${row}`).value = 'SALDO DIA ANTERIOR';
  sheet.getCell(`I${row}`).value = Number(closing.saldo_anterior) || 0;
  row += 2;

  sheet.getCell(`A${row}`).value = 'ENTRADAS DEL DIA'; sheet.getCell(`A${row}`).font = { bold: true }; row++;
  const labelEntradas = {
    factura_electronica: 'FACTURA ELECTRONICA',
    venta_factura_pos: 'VENTA FACTURA POS',
    ingresos_rc: 'INGRESOS POR R.C',
    anticipos_clientes: 'ANTICIPOS CLIENTES (ABONOS)',
    otros_ingresos: 'OTROS INGRESOS',
    cuota_inicial_efectivo: 'CUOTA INICIAL EN EFECTIVO',
  };
  for (const k of ENTRADAS_KEYS) {
    sheet.getCell(`A${row}`).value = labelEntradas[k];
    sheet.getCell(`I${row}`).value = Number(closing.entradas?.[k]) || 0;
    row++;
  }
  const totalEntradas = sumObj(closing.entradas, ENTRADAS_KEYS);
  sheet.getCell(`A${row}`).value = 'TOTAL ENTRADAS DEL DIA'; sheet.getCell(`A${row}`).font = { bold: true };
  sheet.getCell(`I${row}`).value = totalEntradas;
  row += 2;

  sheet.getCell(`A${row}`).value = 'GASTOS POR COMPROBANTES DE PAGO'; sheet.getCell(`A${row}`).font = { bold: true }; row++;
  sheet.getCell(`A${row}`).value = 'Fecha'; sheet.getCell(`B${row}`).value = 'CP No';
  sheet.getCell(`C${row}`).value = 'Tercero'; sheet.getCell(`F${row}`).value = 'Concepto';
  sheet.getCell(`I${row}`).value = 'Valor'; row++;
  const gastos = closing.gastos || [];
  for (const g of gastos) {
    sheet.getCell(`A${row}`).value = g.fecha || closing.fecha;
    sheet.getCell(`B${row}`).value = g.cp_no || '';
    sheet.getCell(`C${row}`).value = g.tercero || '';
    sheet.getCell(`F${row}`).value = g.concepto || '';
    sheet.getCell(`I${row}`).value = Number(g.valor) || 0;
    row++;
  }
  const totalComprobantes = sumGastos(gastos);
  sheet.getCell(`A${row}`).value = 'TOTAL COMPROBANTES DE PAGO'; sheet.getCell(`A${row}`).font = { bold: true };
  sheet.getCell(`I${row}`).value = totalComprobantes; row += 2;

  sheet.getCell(`A${row}`).value = 'TOTAL SALIDAS DEL DIA'; sheet.getCell(`A${row}`).font = { bold: true };
  sheet.getCell(`I${row}`).value = totalComprobantes; row++;
  const totalEfectivoEsperado = (Number(closing.saldo_anterior) || 0) + totalEntradas - totalComprobantes;
  sheet.getCell(`A${row}`).value = 'TOTAL EFECTIVO ESPERADO'; sheet.getCell(`A${row}`).font = { bold: true };
  sheet.getCell(`I${row}`).value = totalEfectivoEsperado; row += 2;

  sheet.getCell(`A${row}`).value = 'CONTEO DEL EFECTIVO'; sheet.getCell(`A${row}`).font = { bold: true }; row++;
  sheet.getCell(`A${row}`).value = 'BILLETES'; sheet.getCell(`E${row}`).value = 'MONEDAS'; row++;
  sheet.getCell(`A${row}`).value = 'Denominacion'; sheet.getCell(`B${row}`).value = 'Cantidad'; sheet.getCell(`C${row}`).value = 'Valor';
  sheet.getCell(`E${row}`).value = 'Denominacion'; sheet.getCell(`F${row}`).value = 'Cantidad'; sheet.getCell(`G${row}`).value = 'Valor';
  row++;
  const maxLen = Math.max(BILLETES.length, MONEDAS.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < BILLETES.length) {
      const d = BILLETES[i]; const cant = Number(closing.conteo?.billetes?.[d]) || 0;
      sheet.getCell(`A${row + i}`).value = d; sheet.getCell(`B${row + i}`).value = cant; sheet.getCell(`C${row + i}`).value = cant * d;
    }
    if (i < MONEDAS.length) {
      const d = MONEDAS[i]; const cant = Number(closing.conteo?.monedas?.[d]) || 0;
      sheet.getCell(`E${row + i}`).value = d; sheet.getCell(`F${row + i}`).value = cant; sheet.getCell(`G${row + i}`).value = cant * d;
    }
  }
  row += maxLen;
  const totalBilletes = BILLETES.reduce((s, d) => s + (Number(closing.conteo?.billetes?.[d]) || 0) * d, 0);
  const totalMonedas = MONEDAS.reduce((s, d) => s + (Number(closing.conteo?.monedas?.[d]) || 0) * d, 0);
  const totalArqueo = totalBilletes + totalMonedas;
  sheet.getCell(`A${row}`).value = 'TOTAL BILLETES'; sheet.getCell(`C${row}`).value = totalBilletes;
  sheet.getCell(`E${row}`).value = 'TOTAL MONEDAS'; sheet.getCell(`G${row}`).value = totalMonedas; row++;
  sheet.getCell(`A${row}`).value = 'TOTAL ARQUEO'; sheet.getCell(`A${row}`).font = { bold: true };
  sheet.getCell(`I${row}`).value = totalArqueo; row++;
  sheet.getCell(`A${row}`).value = 'FALTANTE / SOBRANTE';
  sheet.getCell(`I${row}`).value = totalArqueo - totalEfectivoEsperado; row++;
  sheet.getCell(`A${row}`).value = 'TRASLADO CAJA GENERAL';
  sheet.getCell(`I${row}`).value = totalArqueo - totalComprobantes;

  sheet.getColumn('A').width = 32;
  sheet.getColumn('I').width = 18;
  return await wb.xlsx.writeBuffer();
}
