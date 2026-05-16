import './env.js';

export const SEDES = (process.env.SEDES || 'SMART GADGETS PASTO,SMART GADGETS MEDELLIN,SMART GADGETS ARMENIA,SMART GADGETS PEREIRA')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Cada sede tiene su propia cuenta de Alegra con email + token independientes.
// Variables de entorno por sede usando la palabra clave del nombre:
//   ALEGRA_PASTO_EMAIL,    ALEGRA_PASTO_TOKEN
//   ALEGRA_MEDELLIN_EMAIL, ALEGRA_MEDELLIN_TOKEN
//   ALEGRA_ARMENIA_EMAIL,  ALEGRA_ARMENIA_TOKEN
//   ALEGRA_PEREIRA_EMAIL,  ALEGRA_PEREIRA_TOKEN
// La palabra clave es la primera coincidencia (case-insensitive) que aparezca en el nombre completo de la sede.
const SEDE_KEYS = ['PASTO', 'MEDELLIN', 'ARMENIA', 'PEREIRA'];

export function sedeKey(sede) {
  if (!sede) return null;
  const up = sede.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  for (const k of SEDE_KEYS) {
    if (up.includes(k)) return k;
  }
  return null;
}

export function alegraCredentialsForSede(sede) {
  const key = sedeKey(sede);
  if (!key) return null;
  const email = process.env[`ALEGRA_${key}_EMAIL`];
  const token = process.env[`ALEGRA_${key}_TOKEN`];
  if (!email || !token) return null;
  return { email, token, key };
}

// Cada sede tiene su propia carpeta raiz en Drive.
//   DRIVE_FOLDER_PASTO, DRIVE_FOLDER_MEDELLIN, DRIVE_FOLDER_ARMENIA, DRIVE_FOLDER_PEREIRA
export function driveFolderForSede(sede) {
  const key = sedeKey(sede);
  if (!key) return null;
  return process.env[`DRIVE_FOLDER_${key}`] || null;
}

// Configuracion de estructura de carpetas en Drive POR SEDE.
// Cada sede tiene su propia convencion historica (vista con scripts/analyze-drive.js).
// Las plantillas usan tokens: {MES} (MAYO), {Mes} (Mayo), {mes} (mayo), {YYYY}, {YY}, {MM}, {M}, {DD}, {D}.
//
// Para sobrescribir desde env, usar: DRIVE_PARENT_<KEY>, DRIVE_MONTH_PATTERN_<KEY>,
//   DRIVE_DAY_PATTERN_<KEY>, DRIVE_CIERRE_SUBFOLDER_<KEY>, DRIVE_GASTOS_SUBFOLDER_<KEY>.
// Convencion uniforme para los nombres de mes y dia en todas las sedes:
//   Mes: "CIERRES {MES} {YYYY}"   (ej: "CIERRES MAYO 2026")
//   Dia: "CIERRE {DD}-{MM}-{YYYY}" (ej: "CIERRE 13-05-2026")
// Lo unico que varia por sede es el "padre" (carpeta intermedia que ya existe en Drive y que no
// renombramos). En Pasto y Medellin los meses cuelgan directo de la sede; Armenia tiene una
// carpeta padre llamada "CIERRE CAJA" y Pereira "CIERRE DE CAJA".
const UNIFORM_MONTH = 'CIERRES {MES} {YYYY}';
const UNIFORM_DAY   = 'CIERRE {DD}-{MM}-{YYYY}';
const UNIFORM_GASTOS = 'COMPROBANTES';

const SEDE_DRIVE_DEFAULTS = {
  PASTO:    { parent: '',                monthPattern: UNIFORM_MONTH, dayPattern: UNIFORM_DAY, cierreSubfolder: '', gastosSubfolder: UNIFORM_GASTOS },
  MEDELLIN: { parent: '',                monthPattern: UNIFORM_MONTH, dayPattern: UNIFORM_DAY, cierreSubfolder: '', gastosSubfolder: UNIFORM_GASTOS },
  ARMENIA:  { parent: 'CIERRE CAJA',     monthPattern: UNIFORM_MONTH, dayPattern: UNIFORM_DAY, cierreSubfolder: '', gastosSubfolder: UNIFORM_GASTOS },
  PEREIRA:  { parent: 'CIERRE DE CAJA',  monthPattern: UNIFORM_MONTH, dayPattern: UNIFORM_DAY, cierreSubfolder: '', gastosSubfolder: UNIFORM_GASTOS },
};

function envOr(name, fallback) {
  const v = process.env[name];
  return v != null && v !== '' ? v : fallback;
}

export function driveConfigForSede(sede) {
  const key = sedeKey(sede);
  if (!key) return null;
  const def = SEDE_DRIVE_DEFAULTS[key] || {};
  return {
    key,
    parent: envOr(`DRIVE_PARENT_${key}`, def.parent ?? ''),
    monthPattern: envOr(`DRIVE_MONTH_PATTERN_${key}`, def.monthPattern ?? 'CIERRES {MES}'),
    dayPattern: envOr(`DRIVE_DAY_PATTERN_${key}`, def.dayPattern ?? '{DD}-{MM}'),
    cierreSubfolder: envOr(`DRIVE_CIERRE_SUBFOLDER_${key}`, def.cierreSubfolder ?? ''),
    gastosSubfolder: envOr(`DRIVE_GASTOS_SUBFOLDER_${key}`, def.gastosSubfolder ?? 'COMPROBANTES'),
  };
}

const MESES_ES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

function partsFromDate(dateInput) {
  let y, m, d;
  if (typeof dateInput === 'string') {
    const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) throw new Error('fecha invalida: ' + dateInput);
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else {
    y = dateInput.getFullYear(); m = dateInput.getMonth() + 1; d = dateInput.getDate();
  }
  return { y, m, d };
}

function applyPattern(pattern, dateInput) {
  if (!pattern) return '';
  const { y, m, d } = partsFromDate(dateInput);
  const mesUpper = MESES_ES[m - 1];
  const mesTitle = mesUpper[0] + mesUpper.slice(1).toLowerCase();
  const mesLower = mesUpper.toLowerCase();
  return pattern
    .replace(/\{MES\}/g, mesUpper)
    .replace(/\{Mes\}/g, mesTitle)
    .replace(/\{mes\}/g, mesLower)
    .replace(/\{YYYY\}/g, String(y))
    .replace(/\{YY\}/g, String(y).slice(-2))
    .replace(/\{MM\}/g, String(m).padStart(2, '0'))
    .replace(/\{M\}/g, String(m))
    .replace(/\{DD\}/g, String(d).padStart(2, '0'))
    .replace(/\{D\}/g, String(d));
}

// Devuelve el array de subcarpetas (desde la raiz de la sede) donde guardar archivos del cierre.
// kind: 'cierre' (arqueo + foto de cierre)  |  'gastos' (fotos de comprobantes de gasto)  |  'day' (la carpeta del dia, sin subcarpeta interna)
export function resolveClosingPath({ sede, date, kind = 'cierre' }) {
  const cfg = driveConfigForSede(sede);
  if (!cfg) throw new Error(`No se reconoce la sede: ${sede}`);
  const parts = [];
  if (cfg.parent) parts.push(cfg.parent);
  parts.push(applyPattern(cfg.monthPattern, date));
  parts.push(applyPattern(cfg.dayPattern, date));
  if (kind === 'cierre' && cfg.cierreSubfolder) {
    parts.push(cfg.cierreSubfolder);
  } else if (kind === 'gastos' && cfg.gastosSubfolder) {
    parts.push(cfg.gastosSubfolder);
  }
  return parts;
}

// Denominaciones de billetes y monedas en Colombia.
export const BILLETES = [100000, 50000, 20000, 10000, 5000, 2000, 1000];
export const MONEDAS = [1000, 500, 200, 100, 50];

export const ENTRADAS_KEYS = [
  'factura_electronica',
  'venta_factura_pos',
  'ingresos_rc',
  'anticipos_clientes',
  'otros_ingresos',
  'cuota_inicial_efectivo',
];
