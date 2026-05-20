import axios from 'axios';
import { alegraCredentialsForSede } from '../config.js';

const BASE_URL = 'https://api.alegra.com/api/v1';
const REQUEST_TIMEOUT = 90_000;        // Alegra puede tardar 15-20s por pagina
const STALE_AFTER_MS = 60 * 1000;      // 60s: tras esto la cache se considera "stale" y se refresca en background
const HARD_CACHE_MS  = 30 * 60 * 1000; // 30min: tope absoluto (entrada muy vieja se reemplaza sincronicamente)
const RECENT_KEY_TTL_MS = 60 * 60 * 1000; // 1h: el prefetcher solo refresca keys usadas en la ultima hora
const PREFETCH_INTERVAL_MS = 30 * 1000;   // cada 30s revisamos que refrescar

// cache[key] = { fetchedAt: number, data: any, refreshing: boolean }
const cache = new Map();
// recentKeys[key] = { lastAccess: number, fetcher: () => Promise<any> }
// Cada acceso a fetchWithCache actualiza esto; el prefetcher itera estas keys.
const recentKeys = new Map();

function clientFor(sede) {
  const creds = alegraCredentialsForSede(sede);
  if (!creds) {
    const err = new Error(`No hay credenciales de Alegra configuradas para la sede: ${sede}`);
    err.status = 400;
    throw err;
  }
  const basic = Buffer.from(`${creds.email}:${creds.token}`).toString('base64');
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
    },
    timeout: REQUEST_TIMEOUT,
  });
}

async function paginate(c, path, params) {
  const items = [];
  const limit = 30; // Alegra solo admite limit entre 0 y 30
  let start = 0;
  while (true) {
    const res = await c.get(path, { params: { ...params, start, limit } });
    const batch = Array.isArray(res.data) ? res.data : res.data?.data || [];
    items.push(...batch);
    if (batch.length < limit) break;
    start += limit;
    if (start > 5000) break;
  }
  return items;
}

function isAperturaDeTurno(payment) {
  return /apertura\s*de\s*turno/i.test(String(payment.anotation || payment.observations || ''));
}

function isCierreDeTurno(payment) {
  return /cierre\s*de\s*turno/i.test(String(payment.anotation || payment.observations || ''));
}

function hasInvoiceLink(payment) {
  return Array.isArray(payment.invoices) && payment.invoices.length > 0;
}

// Identifica el banco "POS Terminal 1" de la sede:
//   1) preferido: la cuenta bancaria donde se registro la "Apertura de turno" hoy
//   2) fallback: el bank account con nombre que incluya POS o TERMINAL
function findPosBankId(paymentsIn) {
  for (const p of paymentsIn) {
    if (isAperturaDeTurno(p) && p.bankAccount?.id) return String(p.bankAccount.id);
  }
  for (const p of paymentsIn) {
    const name = String(p.bankAccount?.name || '').toUpperCase();
    if (name.includes('POS') || name.includes('TERMINAL')) return String(p.bankAccount?.id || '');
  }
  return null;
}

function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

// Allowlist de cuentas que se SUMAN en la conciliacion, por categoria de pago.
// La hoja de comprobantes (alimentada por el bot ConfirmadorComprobantes) tiene una
// pestania por proveedor (TRANSFERENCIAS, BOLD, ADDI, BDB, SU+PAY, MERCADOPAGO).
//
// Casos especiales acordados con el usuario:
//   - ADDI: solo "ADDI TIENDA FISICA" porque Addi marketplace se transfiere bulk sin
//     comprobante por transaccion. Si incluyeramos marketplace habria descuadre cronico.
//   - KREDIYA / ADELANTOS: nunca se envian comprobantes de eso, asi que no se cuentan
//     (aunque las cuentas existan en Alegra).
//   - MERCADO PAGO: si se cuenta. La mayoria de transacciones son non-POS pero igual
//     se envian comprobantes y se acumulan en la pestania MERCADOPAGO de la hoja.
//   - Para el resto (Bancolombia, Nequi, Daviplata, Nu Bank, BDB, Sumas): cualquier variante
//     incluyendo marketplace cuenta — esos proveedores SI envian comprobantes por venta.
const ACCOUNT_PATTERNS = {
  transferencia: [
    /BANCOLOMBIA/,
    /NU\s*BANK/,
    /NEQUI/,
    /DAVIPLATA/,
  ],
  datafono: [
    /DATAFONO/,
    /\bBOLD\b/,
  ],
  credito: [
    /SUMAS/,                       // SumasPay (todas variantes)
    /BANCO\s*DE\s*BOGOTA/,         // Banco de Bogota (todas variantes)
    /ADDI\s+TIENDA\s+FISICA/,      // SOLO Addi Tienda Fisica - NO marketplace ni adelantos
    /MERCADO\s*PAGO/,              // Mercado Pago (mayoria non-POS pero envian comprobantes)
  ],
};

function classifyAccount(bankAccount) {
  const name = normalize(bankAccount?.name);
  if (!name) return 'otro';
  for (const [cat, patterns] of Object.entries(ACCOUNT_PATTERNS)) {
    if (patterns.some((p) => p.test(name))) return cat;
  }
  // Cuentas tipo "cash" (Efectivo POS, Caja general) que no matchean lo anterior
  if ((bankAccount?.type || '').toLowerCase() === 'cash') return 'efectivo';
  return 'otro';
}

// Stale-while-revalidate: si hay cache, retorna instantaneo. Si esta stale, dispara
// un refresh en background (no bloquea). Si no hay cache, fetch sincrono.
async function fetchWithCache(cacheKey, fetcher) {
  recentKeys.set(cacheKey, { lastAccess: Date.now(), fetcher });
  const hit = cache.get(cacheKey);
  const now = Date.now();
  if (hit) {
    const age = now - hit.fetchedAt;
    if (age < STALE_AFTER_MS) return hit.data; // fresco
    if (age < HARD_CACHE_MS) {
      // stale - retorna cached y refresca atras
      if (!hit.refreshing) {
        hit.refreshing = true;
        fetcher().then((data) => {
          cache.set(cacheKey, { fetchedAt: Date.now(), data, refreshing: false });
        }).catch(() => { hit.refreshing = false; });
      }
      return hit.data;
    }
  }
  // No cache (o demasiado vieja) - fetch sincrono
  const data = await fetcher();
  cache.set(cacheKey, { fetchedAt: Date.now(), data, refreshing: false });
  return data;
}

async function fetchPayments({ sede, date, type }) {
  return fetchWithCache(`pay|${sede}|${date}|${type}`, async () => {
    const c = clientFor(sede);
    return paginate(c, '/payments', { date, type });
  });
}

async function fetchInvoices({ sede, date }) {
  return fetchWithCache(`inv|${sede}|${date}`, async () => {
    const c = clientFor(sede);
    return paginate(c, '/invoices', { date });
  });
}

// Loop que refresca en background las entradas accedidas recientemente.
// Asi la cache se mantiene siempre fresca para sedes "activas" sin que el usuario espere.
let _prefetchInterval = null;
export function startAlegraPrefetcher() {
  if (_prefetchInterval) return;
  _prefetchInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, info] of recentKeys) {
      if (now - info.lastAccess > RECENT_KEY_TTL_MS) {
        recentKeys.delete(key);
        continue;
      }
      const hit = cache.get(key);
      if (!hit || hit.refreshing) continue;
      if (now - hit.fetchedAt < STALE_AFTER_MS) continue;
      hit.refreshing = true;
      info.fetcher().then((data) => {
        cache.set(key, { fetchedAt: Date.now(), data, refreshing: false });
      }).catch(() => { hit.refreshing = false; });
    }
  }, PREFETCH_INTERVAL_MS);
  _prefetchInterval.unref?.();
}

// Warm-up: precarga la data del dia para una lista de sedes (no bloquea).
export function warmupTodayForSedes(sedes) {
  const today = new Date().toISOString().slice(0, 10);
  for (const sede of sedes) {
    // No await: fire and forget. Si falla por Alegra caida, sigue.
    dailySummary({ date: today, sede }).catch((e) => {
      console.warn(`[alegra warmup] ${sede}: ${e.message}`);
    });
  }
  console.log(`[alegra] warmup disparado para ${sedes.length} sede(s), fecha ${today}`);
}

export async function getPayments({ date, sede, type = 'in' }) {
  return fetchPayments({ sede, date, type });
}

// Convierte un payment de Alegra en un row de "Gastos por comprobantes de pago".
function paymentToGasto(p) {
  const concepto = p.observations
    || p.categories?.[0]?.observations
    || p.anotation
    || '';
  const tercero = p.provider?.name || p.client?.name || '';
  return {
    fecha: p.date,
    cp_no: p.number || String(p.id),
    tercero,
    concepto,
    valor: Number(p.amount) || 0,
    alegra_payment_id: String(p.id),
  };
}

export async function dailySummary({ date, sede }) {
  const [ins, outs] = await Promise.all([
    fetchPayments({ sede, date, type: 'in' }),
    fetchPayments({ sede, date, type: 'out' }),
  ]);

  // Identificamos la cuenta del POS de la sede a partir de la apertura de turno.
  const posBankId = findPosBankId(ins);

  // Buckets para conciliacion: solo las cuentas en la allowlist (ver classifyAccount).
  const buckets = { efectivo: 0, transferencia: 0, datafono: 0, credito: 0, otro: 0 };
  // Detalle para debug: nombre de cuenta -> total
  const porCuenta = {};

  let aperturaDeTurno = 0;
  let ventaFacturaPos = 0;  // pagos al banco POS asociados a factura
  let otrosIngresos = 0;    // pagos al banco POS sin factura (no apertura)
  let totalIngresos = 0;    // suma de todos los ingresos del dia, excluyendo apertura

  for (const p of ins) {
    const amount = Number(p.amount) || 0;
    if (isAperturaDeTurno(p)) {
      aperturaDeTurno += amount;
      continue;
    }
    totalIngresos += amount;
    const cat = classifyAccount(p.bankAccount);
    buckets[cat] = (buckets[cat] || 0) + amount;

    const accName = p.bankAccount?.name || '(sin cuenta)';
    porCuenta[accName] = (porCuenta[accName] || 0) + amount;

    if (posBankId && String(p.bankAccount?.id) === posBankId) {
      if (hasInvoiceLink(p)) ventaFacturaPos += amount;
      else otrosIngresos += amount;
    }
  }

  // Egresos del dia que cuentan como "gastos por comprobantes de pago" del cierre:
  // 1) son del banco POS de la sede (es decir, salieron de la caja de efectivo)
  // 2) no son entradas del sistema de turno: "Apertura de turno" (contra-partida del
  //    ingreso de apertura) ni "Cierre de turno" (retiro automatico al cerrar)
  const gastos = [];
  let totalEgresos = 0;
  for (const p of outs) {
    totalEgresos += Number(p.amount) || 0;
    if (isAperturaDeTurno(p) || isCierreDeTurno(p)) continue;
    if (posBankId && String(p.bankAccount?.id) !== posBankId) continue;
    gastos.push(paymentToGasto(p));
  }
  // Ordenados por CP No (orden cronologico de registro).
  gastos.sort((a, b) => String(a.cp_no).localeCompare(String(b.cp_no), 'es', { numeric: true }));

  return {
    date,
    sede,
    posBankId,
    posBankName: posBankId ? (ins.find(p => String(p.bankAccount?.id) === posBankId)?.bankAccount?.name || null) : null,
    aperturaDeTurno,
    ventaFacturaPos,
    otrosIngresos,
    totalIngresos,
    totalEgresos,
    porMetodo: buckets,
    porCuenta,
    gastos,
    countIngresos: ins.length,
    countEgresos: outs.length,
  };
}

// Sugerencia automatica de valores para el formulario, a partir de Alegra.
// Si no hay datos del dia (ni apertura ni pagos en el banco POS), todo queda en 0.
export async function prefillFromAlegra({ date, sede }) {
  const s = await dailySummary({ date, sede });
  return {
    saldo_anterior_sugerido: s.aperturaDeTurno,
    entradas: {
      venta_factura_pos: s.ventaFacturaPos,
      otros_ingresos: s.otrosIngresos,
    },
    gastos: s.gastos,
    raw: s,
  };
}
