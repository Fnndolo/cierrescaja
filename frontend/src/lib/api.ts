import type { AlegraSummary, Closing, ReconciliationResponse } from './types';

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit, timeoutMs = 90_000): Promise<T> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let detail: any = text;
      try { detail = JSON.parse(text); } catch {}
      throw new Error(typeof detail === 'string' ? detail : detail.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('La solicitud tardo mas de ' + Math.round(timeoutMs/1000) + 's. Recarga la pagina.');
    throw e;
  } finally {
    clearTimeout(tid);
  }
}

export const api = {
  getConfig: () => jsonFetch<{ sedes: string[] }>('/api/config'),

  getOrCreateClosing: (sede: string, fecha: string) =>
    jsonFetch<Closing>('/api/closings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sede, fecha }),
    }),

  getClosingBySedeFecha: (sede: string, fecha: string) =>
    jsonFetch<Closing | null>(`/api/closings/by/${encodeURIComponent(sede)}/${fecha}`),

  patchClosing: (id: number, body: Partial<Closing>) =>
    jsonFetch<Closing>(`/api/closings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  finalizeClosing: (id: number) =>
    jsonFetch<{
      closing: Closing;
      drive: {
        folderId: string;
        excel: { id: string; webViewLink?: string };
        transacciones?: { id: string; name?: string; webViewLink?: string } | null;
      };
      transactionsReportError?: string | null;
    }>(
      `/api/closings/${id}/finalize`,
      { method: 'POST' }
    ),

  reopenClosing: (id: number) =>
    jsonFetch<Closing>(`/api/closings/${id}/reopen`, { method: 'POST' }),

  getAlegraSummary: (sede: string, date: string) =>
    jsonFetch<AlegraSummary>(`/api/alegra/daily-summary?sede=${encodeURIComponent(sede)}&date=${date}`),

  getAlegraPrefill: (sede: string, date: string, opts?: { force?: boolean }) =>
    jsonFetch<{
      saldo_anterior_sugerido: number;
      fetchedAt: number; // timestamp ms cuando Alegra respondio
      entradas: Record<string, number>;
      gastos: Array<{ fecha: string; cp_no: string; tercero: string; concepto: string; valor: number; alegra_payment_id: string }>;
      raw: AlegraSummary & { aperturaDeTurno?: number; ventaFacturaPos?: number; otrosIngresos?: number; posBankId?: string; posBankName?: string };
    }>(`/api/alegra/prefill?sede=${encodeURIComponent(sede)}&date=${date}${opts?.force ? '&force=true' : ''}`),

  getReconciliation: (sede: string, date: string) =>
    jsonFetch<ReconciliationResponse>(`/api/reconciliation?sede=${encodeURIComponent(sede)}&date=${date}`),

  uploadClosingPhoto: async (id: number, file: File) => {
    const fd = new FormData();
    fd.append('photo', file);
    return jsonFetch<{ ok: boolean; file: { id: string; webViewLink?: string } }>(
      `/api/uploads/closings/${id}/closing-photo`,
      { method: 'POST', body: fd }
    );
  },

  uploadComprobantes: async (id: number, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('photos', f);
    return jsonFetch<{
      ok: boolean;
      added: Array<{ drive_file_id: string; name: string; web_view_link?: string | null }>;
      photos: Array<{ drive_file_id: string; name: string; web_view_link?: string | null }>;
    }>(`/api/uploads/closings/${id}/comprobantes`, { method: 'POST', body: fd });
  },

  deleteComprobante: async (id: number, driveFileId: string) => {
    return jsonFetch<{ ok: boolean; photos: Array<{ drive_file_id: string }> }>(
      `/api/uploads/closings/${id}/comprobantes/${encodeURIComponent(driveFileId)}`,
      { method: 'DELETE' }
    );
  },

  uploadAlegraFile: async (id: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return jsonFetch<{ ok: boolean; file: { id: string; webViewLink?: string } }>(
      `/api/uploads/closings/${id}/alegra-file`,
      { method: 'POST', body: fd }
    );
  },
};
