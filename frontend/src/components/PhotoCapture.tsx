import { useRef, useState } from 'react';

type Props = {
  label: string;
  onUpload: (file: File) => Promise<{ webViewLink?: string; id?: string } | void>;
  uploadedId?: string | null;
  uploadedLink?: string | null;
  disabled?: boolean;
  allowFiles?: boolean; // si true muestra tambien boton para subir archivos cualquiera
};

export default function PhotoCapture({ label, onUpload, uploadedId, uploadedLink, disabled, allowFiles }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ url: string; type: string; name: string } | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>(uploadedId ? 'done' : 'idle');
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(uploadedLink || null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setPreview({ url: URL.createObjectURL(file), type: file.type || '', name: file.name });
    setStatus('uploading');
    setErr(null);
    try {
      const r = await onUpload(file);
      if (r && 'webViewLink' in r && r.webViewLink) setLink(r.webViewLink);
      setStatus('done');
    } catch (e: any) {
      setStatus('error');
      setErr(e.message || 'Error subiendo');
    }
  }

  const isImage = preview?.type.startsWith('image/');

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {status === 'done' && (link || uploadedId) && (
          <a
            href={link || `https://drive.google.com/file/d/${uploadedId}/view`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent underline"
          >Ver en Drive</a>
        )}
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={disabled}
        onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
      />
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        disabled={disabled}
        onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
      />

      <div className={`grid gap-2 ${allowFiles ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={disabled || status === 'uploading'}
          className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {status === 'uploading' ? 'Subiendo…' : status === 'done' ? '📷 Reemplazar con foto' : '📷 Tomar foto'}
        </button>
        {allowFiles && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || status === 'uploading'}
            className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            {status === 'done' ? '📎 Reemplazar con archivo' : '📎 Subir archivo'}
          </button>
        )}
      </div>

      {preview && (
        isImage ? (
          <img src={preview.url} alt="preview" className="mt-2 max-h-48 w-full rounded object-contain" />
        ) : (
          <div className="mt-2 truncate rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
            📄 {preview.name}
          </div>
        )
      )}
      {err && <div className="mt-2 text-xs text-red-700">{err}</div>}
    </div>
  );
}
