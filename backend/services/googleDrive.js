import { Readable } from 'node:stream';
import { getDrive } from './googleAuth.js';
import { driveFolderForSede, resolveClosingPath } from '../config.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const folderCache = new Map(); // key: parentId/name  -> folderId

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

// Asegura la ruta hasta la carpeta donde se guardan los archivos del cierre de un dia.
// La ruta exacta depende de la sede (ver SEDE_DRIVE_DEFAULTS en config.js).
// kind: 'cierre' = arqueo + foto del cierre
//       'gastos' = fotos de comprobantes de gasto
//       'day'    = carpeta del dia sin subcarpeta interna
export async function ensureClosingFolder({ sede, date, kind = 'cierre' }) {
  const sedeRoot = driveFolderForSede(sede);
  if (!sedeRoot) {
    throw new Error(`No hay DRIVE_FOLDER_<SEDE> configurado para: ${sede}`);
  }
  const parts = resolveClosingPath({ sede, date, kind });
  return ensureFolderPathFrom(sedeRoot, parts);
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
