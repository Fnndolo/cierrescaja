// Convierte un PDF en una lista de PNGs (uno por pagina), devueltos como data: URLs
// listos para embeber en HTML. Cachea por driveFileId para que reimprimir sea instantaneo.
import { pdf } from 'pdf-to-img';

// cache: driveFileId -> { fetchedAt, dataUrls }
const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h (los PDFs ya subidos a Drive no cambian)

export async function pdfToPngDataUrls(pdfBuffer, { scale = 2, cacheKey = null } = {}) {
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.dataUrls;
  }

  const doc = await pdf(pdfBuffer, { scale });
  const urls = [];
  for await (const png of doc) {
    urls.push('data:image/png;base64,' + png.toString('base64'));
  }

  if (cacheKey) cache.set(cacheKey, { fetchedAt: Date.now(), dataUrls: urls });
  return urls;
}
