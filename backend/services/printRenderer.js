// Renderiza una pagina HTML auto-imprimible con el cierre del turno + arqueo + transacciones.
// Se sirve desde /api/closings/:id/print y al cargarse dispara window.print() solo.

import { BILLETES, MONEDAS, ENTRADAS_KEYS } from '../config.js';

const ENTRADA_LABELS = {
  factura_electronica: 'FACTURA ELECTRONICA',
  venta_factura_pos: 'VENTA FACTURA POS',
  ingresos_rc: 'INGRESOS POR R.C',
  anticipos_clientes: 'ANTICIPOS CLIENTES (ABONOS)',
  otros_ingresos: 'OTROS INGRESOS',
  cuota_inicial_efectivo: 'CUOTA INICIAL EN EFECTIVO',
};

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const fmtMoney = (n) => COP.format(Number(n) || 0);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function sumObj(obj, keys) {
  let s = 0;
  for (const k of keys) s += Number(obj?.[k]) || 0;
  return s;
}

function sumConteo(conteo) {
  if (!conteo) return 0;
  let s = 0;
  for (const d of BILLETES) s += (Number(conteo.billetes?.[d]) || 0) * d;
  for (const d of MONEDAS) s += (Number(conteo.monedas?.[d]) || 0) * d;
  return s;
}

function fechaToString(fecha) {
  if (!fecha) return '';
  return fecha.toISOString ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10);
}

function arqueoSection(closing) {
  const totalEntradas = sumObj(closing.entradas, ENTRADAS_KEYS);
  const gastos = closing.gastos || [];
  const totalGastos = gastos.reduce((s, g) => s + (Number(g.valor) || 0), 0);
  const saldoAnt = Number(closing.saldo_anterior) || 0;
  const totalArqueo = sumConteo(closing.conteo);
  const efectivoEsperado = saldoAnt + totalEntradas - totalGastos;
  const faltSob = totalArqueo - efectivoEsperado;
  const traslado = totalArqueo - totalGastos;

  const entradasRows = ENTRADAS_KEYS.map((k) => `
    <tr><td>${ENTRADA_LABELS[k]}</td><td class="r">${fmtMoney(closing.entradas?.[k])}</td></tr>
  `).join('');

  const gastosRows = gastos.map((g) => `
    <tr>
      <td>${escapeHtml(g.fecha || closing.fecha)}</td>
      <td>${escapeHtml(g.cp_no || '')}</td>
      <td>${escapeHtml(g.tercero || '')}</td>
      <td>${escapeHtml(g.concepto || '')}</td>
      <td class="r">${fmtMoney(g.valor)}</td>
    </tr>`).join('');

  const billetesRows = BILLETES.map((d) => {
    const cant = Number(closing.conteo?.billetes?.[d]) || 0;
    return `<tr><td class="r">${fmtMoney(d)}</td><td class="c">${cant}</td><td class="r">${fmtMoney(cant * d)}</td></tr>`;
  }).join('');
  const monedasRows = MONEDAS.map((d) => {
    const cant = Number(closing.conteo?.monedas?.[d]) || 0;
    return `<tr><td class="r">${fmtMoney(d)}</td><td class="c">${cant}</td><td class="r">${fmtMoney(cant * d)}</td></tr>`;
  }).join('');

  return `
  <section class="page arqueo">
    <h1>ARQUEO DE CAJA - ${escapeHtml(closing.sede)}</h1>
    <div class="meta">
      <span><b>Fecha:</b> ${fechaToString(closing.fecha)}</span>
      <span><b>Hora:</b> ${closing.hora ? String(closing.hora).slice(0, 5) : ''}</span>
      <span><b>Responsable:</b> ${escapeHtml(closing.responsable || '')}</span>
    </div>

    <table class="kv">
      <tr><td><b>SALDO DIA ANTERIOR</b></td><td class="r"><b>${fmtMoney(saldoAnt)}</b></td></tr>
    </table>

    <h3>ENTRADAS DEL DIA</h3>
    <table class="kv">
      ${entradasRows}
      <tr class="total"><td><b>TOTAL ENTRADAS</b></td><td class="r"><b>${fmtMoney(totalEntradas)}</b></td></tr>
    </table>

    <h3>GASTOS POR COMPROBANTES DE PAGO</h3>
    <table class="grid">
      <thead><tr><th>Fecha</th><th>CP No</th><th>Tercero</th><th>Concepto</th><th>Valor</th></tr></thead>
      <tbody>${gastosRows || '<tr><td colspan="5" class="c">(sin gastos)</td></tr>'}</tbody>
      <tfoot><tr class="total"><td colspan="4"><b>TOTAL COMPROBANTES</b></td><td class="r"><b>${fmtMoney(totalGastos)}</b></td></tr></tfoot>
    </table>

    <h3>CONTEO DEL EFECTIVO</h3>
    <div class="conteo">
      <div>
        <h4>Billetes</h4>
        <table class="grid">
          <thead><tr><th>Denom</th><th>Cant</th><th>Valor</th></tr></thead>
          <tbody>${billetesRows}</tbody>
        </table>
      </div>
      <div>
        <h4>Monedas</h4>
        <table class="grid">
          <thead><tr><th>Denom</th><th>Cant</th><th>Valor</th></tr></thead>
          <tbody>${monedasRows}</tbody>
        </table>
      </div>
    </div>

    <table class="kv resumen">
      <tr><td><b>TOTAL ARQUEO</b></td><td class="r"><b>${fmtMoney(totalArqueo)}</b></td></tr>
      <tr><td>Efectivo esperado</td><td class="r">${fmtMoney(efectivoEsperado)}</td></tr>
      <tr class="${Math.abs(faltSob) < 1 ? 'ok' : 'bad'}">
        <td><b>FALTANTE / SOBRANTE</b></td><td class="r"><b>${fmtMoney(faltSob)}</b></td>
      </tr>
      <tr><td>Traslado caja general</td><td class="r">${fmtMoney(traslado)}</td></tr>
    </table>
  </section>`;
}

function transaccionesSection(closing, transacciones) {
  if (!transacciones || transacciones.length === 0) {
    return `
    <section class="page trans">
      <h1>TRANSACCIONES (EGRESOS) - ${escapeHtml(closing.sede)}</h1>
      <p class="c">No hay transacciones de egreso para este dia.</p>
    </section>`;
  }
  const rows = transacciones.map((p) => `
    <tr>
      <td>${escapeHtml(p.bankAccount?.name || '')}</td>
      <td class="c">${escapeHtml(String(p.number ?? p.id ?? ''))}</td>
      <td>${escapeHtml(p.observations || p.anotation || '')}</td>
      <td>${escapeHtml(p.categories?.[0]?.name || '')}</td>
      <td class="r">${fmtMoney(p.amount)}</td>
    </tr>`).join('');
  const total = transacciones.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return `
  <section class="page trans">
    <h1>TRANSACCIONES (EGRESOS) - ${escapeHtml(closing.sede)}</h1>
    <p class="sub">Fecha: ${fechaToString(closing.fecha)}</p>
    <table class="grid">
      <thead>
        <tr><th>Cuenta</th><th>N°</th><th>Concepto</th><th>Categoria</th><th>Valor</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total"><td colspan="4"><b>TOTAL</b></td><td class="r"><b>${fmtMoney(total)}</b></td></tr></tfoot>
    </table>
  </section>`;
}

// Acepta un array de URLs/data-URLs de imagenes. Para PDF se pasan varias paginas;
// para imagen, una sola URL al proxy. Si esta vacio, muestra un placeholder.
function cierrePhotoSection(closing, photoSrcs) {
  if (!photoSrcs || photoSrcs.length === 0) {
    return `
    <section class="page cierre">
      <h1>CIERRE DEL TURNO - ${escapeHtml(closing.sede)}</h1>
      <p class="c">(No se subio foto / archivo del cierre del turno)</p>
    </section>`;
  }
  // Una pagina por imagen (un PDF de N paginas -> N paginas en la impresion)
  return photoSrcs.map((src, i) => `
    <section class="page cierre">
      <h1>CIERRE DEL TURNO - ${escapeHtml(closing.sede)}${photoSrcs.length > 1 ? ` (${i + 1}/${photoSrcs.length})` : ''}</h1>
      <p class="sub">${fechaToString(closing.fecha)}</p>
      <div class="cierre-media">
        <img src="${src}" alt="Cierre del turno" />
      </div>
    </section>`).join('');
}

export function renderPrintPage({ closing, transacciones, photoSrcs }) {
  const styles = `
    * { box-sizing: border-box; }
    @page { size: letter; margin: 8mm; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { page-break-after: always; }
      .page:last-child { page-break-after: auto; }
    }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #000; margin: 0; padding: 6mm; }
    h1 { font-size: 14px; margin: 0 0 6px; text-align: center; }
    h3 { font-size: 11px; margin: 8px 0 3px; background: #eee; padding: 3px 5px; }
    h4 { font-size: 10px; margin: 4px 0 2px; }
    .sub { font-size: 9px; color: #666; margin: 0 0 6px; text-align: center; }
    .meta { display: flex; gap: 12px; justify-content: space-between; font-size: 9px; border: 1px solid #000; padding: 4px 6px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    .kv td { border: 1px solid #999; padding: 2px 6px; }
    .grid th, .grid td { border: 1px solid #000; padding: 2px 4px; }
    .grid th { background: #eee; font-weight: bold; text-align: left; }
    .r { text-align: right; }
    .c { text-align: center; }
    .total { background: #f5f5f5; }
    .ok { background: #e8f5e8; }
    .bad { background: #fee; }
    .resumen { margin-top: 8px; }
    .conteo { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .arqueo { font-size: 10px; }
    .trans { font-size: 9px; }
    .trans .grid th, .trans .grid td { padding: 1px 3px; }
    .cierre-media { display: flex; justify-content: center; align-items: center; height: 24cm; }
    .cierre-media img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .cierre-media .pdf { width: 100%; height: 100%; border: none; }
    .toolbar { position: fixed; top: 5px; right: 5px; background: #fff; border: 1px solid #999; padding: 6px 10px; border-radius: 4px; font-size: 12px; box-shadow: 0 2px 6px rgba(0,0,0,.2); z-index: 1000; }
    @media print { .toolbar { display: none; } }
    .toolbar button { padding: 4px 10px; cursor: pointer; }
  `;

  const body = `
    <div class="toolbar">
      <button onclick="window.print()">🖨 Imprimir</button>
      <button onclick="window.close()">Cerrar</button>
    </div>
    ${cierrePhotoSection(closing, photoSrcs)}
    ${arqueoSection(closing)}
    ${transaccionesSection(closing, transacciones)}
  `;

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Imprimir cierre - ${escapeHtml(closing.sede)} - ${fechaToString(closing.fecha)}</title>
  <style>${styles}</style>
</head>
<body>
  ${body}
  <script>
    // Espera a que TODAS las imagenes del cierre carguen antes de disparar print
    function fireAuto() {
      setTimeout(() => { try { window.print(); } catch(e) {} }, 500);
    }
    const imgs = Array.from(document.querySelectorAll('.cierre-media img'));
    if (imgs.length === 0) {
      fireAuto();
    } else {
      let pending = imgs.length;
      const done = () => { if (--pending <= 0) fireAuto(); };
      imgs.forEach((img) => {
        if (img.complete) done();
        else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }
      });
      // Failsafe: si algo se cuelga, imprime a los 8s igual
      setTimeout(() => { try { window.print(); } catch(e) {} }, 8000);
    }
  </script>
</body>
</html>`;
}
