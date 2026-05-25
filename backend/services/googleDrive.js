import { Readable } from 'node:stream';
import { getDrive } from './googleAuth.js';
import {
  driveFolderForSede,
  driveConfigForSede,
  applyPattern,
  partsFromDate,
  MESES_ES,
} from '../config.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const folderCache = new Map(); // key: parentId/name  -> folderId
const monthFolderCache = new Map(); // key: parentId|sede|YYYY-MM -> folderId

function bufferToStream(buffer) {
  return Readable.from(buffer);
}

async function findChildFolder(drive, parentId, name) {
  const q = [
    `'${parentId}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    'trashed = false',
  ].join(' and ');
  const res = await drive.files.list({
    q,
    fields: 'files(id, name)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0] || null;
}

async function createFolder(drive, parentId, name) {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
    fields: 'id, name',
    supportsAllDrives: true,
  });
  return res.data;
}

// Asegura una ruta de subcarpetas dentro de un padre dado (parentId).
// Crea los niveles que no existan y devuelve el id del ultimo.
export async function ensureFolderPathFrom(parentId, parts) {
  if (!parentId) throw new Error('parentId requerido');
  const drive = getDrive();
  let currentId = parentId;
  for (const name of parts) {
    if (!name) continue;
    const cacheKey = `${currentId}/${name}`;
    if (folderCache.has(cacheKey)) {
      currentId = folderCache.get(cacheKey);
      continue;
    }
    let folder = await findChildFolder(drive, currentId, name);
    if (!folder) folder = await createFolder(drive, currentId, name);
    folderCache.set(cacheKey, folder.id);
    currentId = folder.id;
  }
  return currentId;
}

// Busca la carpeta del mes haciendo "fuzzy match": si ya existe alguna carpeta cuyo nombre
// contiene el nombre del mes (ej. "CIERRES MAYO", "CIERRES MAYO 2026", "MAYO", "MAYO 2025"),
// la reutilizamos. Si no encuentra nada, crea con el nombre canonico del patron.
// Prioridad: 1) match exacto canonical  2) contiene MES y el año actual  3) contiene MES sin año  4) primera con MES
async function ensureMonthFolder(parentId, sede, date) {
  const cfg = driveConfigForSede(sede);
  const { y, m } = partsFromDate(date);
  const mesUpper = MESES_ES[m - 1];
  const canonical = applyPattern(cfg.monthPattern, date);
  const cacheKey = `${parentId}|${cfg.key}|${y}-${String(m).padStart(2, '0')}`;

  if (monthFolderCache.has(cacheKey)) return monthFolderCache.get(cacheKey);

  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const folders = res.data.files || [];
  const norm = (s) => String(s || '').toUpperCase();

  // 1) Match exacto con el patron canonical
  let chosen = folders.find((f) => f.name === canonical);
  // 2) Match: nombre contiene MES y el año actual
  if (!chosen) chosen = folders.find((f) => norm(f.name).includes(mesUpper) && f.name.includes(String(y)));
  // 3) Match: nombre contiene MES y NO contiene ningun año de 4 digitos (formato corto tipo "CIERRES MAYO")
  if (!chosen) chosen = folders.find((f) => norm(f.name).includes(mesUpper) && !/\b\d{4}\b/.test(f.name));
  // 4) Primera con MES (fallback)
  if (!chosen) chosen = folders.find((f) => norm(f.name).includes(mesUpper));

  if (!chosen) {
    chosen = await createFolder(drive, parentId, canonical);
    console.log(`[drive] carpeta mes creada: "${canonical}" en ${parentId}`);
  } else {
    console.log(`[drive] carpeta mes reusada: "${chosen.name}" (canonical era "${canonical}")`);
  }
  monthFolderCache.set(cacheKey, chosen.id);
  return chosen.id;
}

// Asegura la ruta hasta la carpeta donde se guardan los archivos del cierre de un dia.
// La ruta exacta depende de la sede (ver SEDE_DRIVE_DEFAULTS en config.js).
// La carpeta del mes se reusa si ya existe con cualquier variante razonable del nombre.
// kind: 'cierre' = arqueo + foto del cierre
//       'gastos' = fotos de comprobantes de gasto
//       'day'    = carpeta del dia sin subcarpeta interna
export async function ensureClosingFolder({ sede, date, kind = 'cierre' }) {
  const sedeRoot = driveFolderForSede(sede);
  if (!sedeRoot) {
    throw new Error(`No hay DRIVE_FOLDER_<SEDE> configurado para: ${sede}`);
  }
  const cfg = driveConfigForSede(sede);

  // 1) Padre intermedio (ej. "CIERRE CAJA" para ARMENIA) — match exacto
  let parent = sedeRoot;
  if (cfg.parent) parent = await ensureFolderPathFrom(parent, [cfg.parent]);

  // 2) Carpeta del mes — fuzzy match (reusa la existente si ya hay alguna del mes)
  parent = await ensureMonthFolder(parent, sede, date);

  // 3) Carpeta del dia + subcarpeta opcional segun kind — match exacto
  const tail = [applyPattern(cfg.dayPattern, date)];
  if (kind === 'cierre' && cfg.cierreSubfolder) tail.push(cfg.cierreSubfolder);
  else if (kind === 'gastos' && cfg.gastosSubfolder) tail.push(cfg.gastosSubfolder);

  return ensureFolderPathFrom(parent, tail);
}

export async function uploadFile({ folderId, name, mimeType, buffer }) {
  const drive = getDrive();
  const res = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: bufferToStream(buffer),
    },
    fields: 'id, name, webViewLink, webContentLink',
    supportsAllDrives: true,
  });
  return res.data;
}

export async function getWebViewLink(fileId) {
  const drive = getDrive();
  const res = await drive.files.get({
    fileId,
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });
  return res.data;
}

export async function deleteFile(fileId) {
  const drive = getDrive();
  await drive.files.delete({ fileId, supportsAllDrives: true });
}

// Lista los hijos directos (carpetas y archivos) de un folder.
export async function listChildren(parentId, { onlyFolders = false } = {}) {
  const drive = getDrive();
  const qParts = [`'${parentId}' in parents`, 'trashed = false'];
  if (onlyFolders) qParts.push(`mimeType = '${FOLDER_MIME}'`);
  const all = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: qParts.join(' and '),
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 200,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    all.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return all;
}

export async function getFileInfo(fileId) {
  const drive = getDrive();
  const res = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, owners(emailAddress,displayName), permissions(emailAddress,role)',
    supportsAllDrives: true,
  });
  return res.data;
}

// Descarga el contenido binario de un archivo de Drive en memoria.
// Devuelve { mimeType, name, buffer }.
export async function getFileBytes(fileId) {
  const drive = getDrive();
  const meta = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType',
    supportsAllDrives: true,
  });
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return {
    mimeType: meta.data.mimeType || 'application/octet-stream',
    name: meta.data.name || '',
    buffer: Buffer.from(res.data),
  };
}
