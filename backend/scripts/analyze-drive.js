// Recorre las 4 carpetas raiz de sede en Drive y muestra su estructura.
// Uso: cd backend && node scripts/analyze-drive.js
//
// Requiere que en .env esten configurados:
//   GOOGLE_SERVICE_ACCOUNT_JSON
//   DRIVE_FOLDER_PASTO, DRIVE_FOLDER_MEDELLIN, DRIVE_FOLDER_ARMENIA, DRIVE_FOLDER_PEREIRA
//
// Y que el service account tenga permiso de Editor (o lector) sobre cada carpeta raiz.

import '../env.js';
import { SEDES, sedeKey, driveFolderForSede } from '../config.js';
import { listChildren, getFileInfo } from '../services/googleDrive.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function isFolder(file) {
  return file.mimeType === FOLDER_MIME;
}

async function describeFolder(folderId, prefix = '') {
  try {
    const info = await getFileInfo(folderId);
    console.log(`${prefix}\u{1F4C1} ${info.name}  (id: ${info.id})`);
  } catch (err) {
    console.log(`${prefix}❌  No pude leer el folder ${folderId}: ${err.message}`);
    return null;
  }
  return true;
}

async function listAndPrint(folderId, indent = '  ', depthRemaining = 2) {
  let folders;
  try {
    folders = await listChildren(folderId, { onlyFolders: true });
  } catch (err) {
    console.log(`${indent}❌ error listando: ${err.message}`);
    return;
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  for (const f of folders) {
    console.log(`${indent}\u{1F4C1} ${f.name}`);
    if (depthRemaining > 0) {
      await listAndPrint(f.id, indent + '   ', depthRemaining - 1);
    }
  }
}

(async () => {
  console.log('Analisis de estructura de Drive\n================================\n');

  for (const sede of SEDES) {
    const key = sedeKey(sede);
    const folderId = driveFolderForSede(sede);

    console.log(`\n\u{1F3EC} ${sede}  (key=${key})`);
    console.log('-'.repeat(60));

    if (!folderId) {
      console.log(`  ⚠  No hay DRIVE_FOLDER_${key} configurada en .env, salto.`);
      continue;
    }

    const ok = await describeFolder(folderId, '  ');
    if (!ok) continue;

    console.log('  Hijos directos:');
    try {
      await listAndPrint(folderId, '   ', 2);
    } catch (err) {
      console.log(`   ❌ error recorriendo: ${err.message}`);
    }
  }

  console.log('\nListo. Copia y pega esta salida en el chat para que ajustemos los nombres de las carpetas padre por sede.');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
