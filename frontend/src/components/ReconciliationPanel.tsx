import { useState } from 'react';
import Section from './Section';
import { api } from '../lib/api';
import { formatCOP } from '../lib/format';
import type { ReconciliationResponse } from '../lib/types';

type Props = {
  sede: string;
  fecha: string;
};

const STATUS_STYLE: Record<string, string> = {
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  comprobantes_mayor: 'bg-amber-50 text-amber-900 border-amber-300',
  alegra_mayor: 'bg-red-50 text-red-800 border-red-300',
  info: 'bg-slate-50 text-slate-700 border-slate-200',
};

const STATUS_LABEL: Record<string, string> = {
  ok: 'Cuadrado',
  comprobantes_mayor: 'Comprobantes > Alegra → revisar Alegra',
  alegra_mayor: 'Alegra > Comprobantes → falta comprobante',
  info: 'Sólo referencia',
};

export default function ReconciliationPanel({ sede, fecha }: Props) {
  const [data, setData] = useState<ReconciliationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.getReconciliation(sede, fecha);
      setData(r);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title="Conciliación Alegra vs Comprobantes" defaultOpen>
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="w-full rounded bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {loading ? 'Comparando…' : data ? 'Recalcular' : 'Comparar ahora'}
      </button>
      {err && <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {data && (
        <div className="mt-4 space-y-2">
          {data.categorias.map((c) => (
            <div
              key={c.clave}
              className={`rounded border px-3 py-2 ${STATUS_STYLE[c.status]}`}
            >
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>{c.label}</span>
                <span className="text-xs uppercase">{STATUS_LABEL[c.status]}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div><div className="text-slate-500">Alegra</div><div className="font-medium">{formatCOP(c.alegra)}</div></div>
                <div><div className="text-slate-500">Comprobantes</div><div className="font-medium">{c.comprobantes == null ? '—' : formatCOP(c.comprobantes)}</div></div>
                <div><div className="text-slate-500">Diferencia</div><div className="font-medium">{c.comprobantes == null ? '—' : formatCOP(c.diff)}</div></div>
              </div>
              {c.nota && <div className="mt-1 text-xs italic text-slate-600">{c.nota}</div>}
            </div>
          ))}

          <details className="mt-3 rounded border border-slate-200 bg-white p-3 text-xs">
            <summary className="cursor-pointer font-medium text-slate-700">Ver detalle por pestaña de la hoja</summary>
            <table className="mt-2 w-full text-xs">
              <thead><tr className="text-left text-slate-500"><th>Pestaña</th><th>Total</th><th># filas</th></tr></thead>
              <tbody>
                {Object.entries(data.comprobantes.tabs).map(([tab, info]) => (
                  <tr key={tab} className="border-t border-slate-100">
                    <td>{tab}</td>
                    <td>{formatCOP(info.total)}</td>
                    <td>{info.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          {(data.alegra as any).porCuenta && (
            <details className="mt-2 rounded border border-slate-200 bg-white p-3 text-xs">
              <summary className="cursor-pointer font-medium text-slate-700">Ver detalle por cuenta de Alegra (sin apertura de turno)</summary>
              <table className="mt-2 w-full text-xs">
                <thead><tr className="text-left text-slate-500"><th>Cuenta</th><th>Total</th></tr></thead>
                <tbody>
                  {Object.entries((data.alegra as any).porCuenta as Record<string, number>)
                    .sort(([,a], [,b]) => b - a)
                    .map(([acc, total]) => (
                      <tr key={acc} className="border-t border-slate-100">
                        <td className="truncate" title={acc}>{acc}</td>
                        <td>{formatCOP(total)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </Section>
  );
}
