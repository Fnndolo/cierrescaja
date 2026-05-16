import { useRef, useState } from 'react';
import Section from './Section';
import { api } from '../lib/api';
import type { ClosingPhoto } from '../lib/types';

type Props = {
  closingId: number;
  photos: ClosingPhoto[];
  onChange: (next: ClosingPhoto[]) => void;
  disabled?: boolean;
};

export default function ComprobantesGallery({ closingId, photos, onChange, disabled }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Para feedback inmediato mientras Drive sube en background:
  const [previews, setPreviews] = useState<{ id: string; url: string }[]>([]);
  const previewCounter = useRef(0);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setError(null);

    const localPrev = files.map((f) => ({
      id: `prev-${Date.now()}-${++previewCounter.current}`,
      url: URL.createObjectURL(f),
    }));
    setPreviews((p) => [...p, ...localPrev]);
    setUploading(true);
    try {
      const r = await api.uploadComprobantes(closingId, files);
      onChange(r.photos);
    } catch (e: any) {
      setError(e.message || 'Error subiendo fotos');
    } finally {
      setUploading(false);
      setPreviews((p) => p.filter((x) => !localPrev.find((l) => l.id === x.id)));
      localPrev.forEach((l) => URL.revokeObjectURL(l.url));
    }
  }

  async function remove(p: ClosingPhoto) {
    if (!confirm('Eliminar esta foto?')) return;
    try {
      const r = await api.deleteComprobante(closingId, p.drive_file_id);
      onChange(r.photos as ClosingPhoto[]);
    } catch (e: any) {
      alert('No pude eliminar: ' + e.message);
    }
  }

  return (
    <Section
      title="Comprobantes (fotos)"
      subtitle={<span>{photos.length} foto{photos.length === 1 ? '' : 's'} subida{photos.length === 1 ? '' : 's'}</span>}
    >
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => cameraRef.current?.click()}
          className="rounded bg-accent px-3 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          📷 Tomar foto
        </button>
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => galleryRef.current?.click()}
          className="rounded border border-slate-300 px-3 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
        >
          🖼 Elegir de galería
        </button>
      </div>
      <p className="mb-2 text-xs text-slate-500">
        Puedes tomar muchas fotos: dale a "Tomar foto", capturas, guardas, y vuelves a darle para la siguiente.
        Desde "Galería" puedes seleccionar varias a la vez.
      </p>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
      />

      {uploading && (
        <div className="mb-2 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">Subiendo a Drive…</div>
      )}
      {error && (
        <div className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {previews.map((p) => (
          <div key={p.id} className="relative aspect-square overflow-hidden rounded bg-slate-100">
            <img src={p.url} className="h-full w-full object-cover opacity-60" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-xs text-white">subiendo…</div>
          </div>
        ))}
        {photos.map((p) => (
          <div key={p.drive_file_id} className="group relative aspect-square overflow-hidden rounded border border-slate-200 bg-slate-50">
            <a
              href={p.web_view_link || `https://drive.google.com/file/d/${p.drive_file_id}/view`}
              target="_blank"
              rel="noreferrer"
              className="block h-full w-full"
            >
              <img
                src={`/api/photos/${p.drive_file_id}`}
                alt={p.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 truncate bg-black/40 px-1 py-0.5 text-[10px] text-white">
                {p.name}
              </div>
            </a>
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(p)}
                className="absolute right-1 top-1 rounded-full bg-red-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white opacity-0 group-hover:opacity-100"
                title="Eliminar"
              >✕</button>
            )}
          </div>
        ))}
      </div>
      {photos.length === 0 && previews.length === 0 && (
        <div className="rounded border border-dashed border-slate-300 py-6 text-center text-xs text-slate-500">
          Aún no hay fotos. Usa los botones de arriba.
        </div>
      )}
    </Section>
  );
}
