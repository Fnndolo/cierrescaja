import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { todayISO } from '../lib/format';

type Props = {
  initialSede?: string;
  initialFecha?: string;
  onReady: (sede: string, fecha: string) => void;
};

export default function SedeFechaPicker({ initialSede, initialFecha, onReady }: Props) {
  const [sedes, setSedes] = useState<string[]>([]);
  const [sede, setSede] = useState<string>(initialSede || '');
  const [fecha, setFecha] = useState<string>(initialFecha || todayISO());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then(({ sedes }) => {
      setSedes(sedes);
      if (!sede && sedes[0]) setSede(sedes[0]);
    }).catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-cargar Alegra en background mientras el usuario esta en la pantalla de seleccion,
  // para que al entrar al cierre los datos ya esten cacheados en el backend.
  useEffect(() => {
    if (!sede || !fecha) return;
    const t = setTimeout(() => {
      fetch(`/api/alegra/prefill?sede=${encodeURIComponent(sede)}&date=${fecha}`).catch(() => {});
    }, 800); // debounce: solo si la seleccion no cambia en 800ms
    return () => clearTimeout(t);
  }, [sede, fecha]);

  const submit = async () => {
    if (!sede || !fecha) return;
    setLoading(true);
    setErr(null);
    try {
      onReady(sede, fecha);
    } catch (e: any) {
      setErr(e.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md p-4">
      <div className="rounded-lg bg-white p-6 shadow-md">
        <h1 className="text-xl font-bold text-brand">Cierres de Caja</h1>
        <p className="mt-1 text-sm text-slate-500">Selecciona la sede y la fecha del cierre.</p>

        <label className="mt-4 block text-sm font-medium text-slate-700">Sede</label>
        <select
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-base focus:border-accent focus:outline-none"
          value={sede}
          onChange={(e) => setSede(e.target.value)}
        >
          <option value="" disabled>Selecciona una sede</option>
          {sedes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <label className="mt-4 block text-sm font-medium text-slate-700">Fecha</label>
        <input
          type="date"
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-base focus:border-accent focus:outline-none"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
        />

        {err && <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

        <button
          type="button"
          disabled={!sede || !fecha || loading}
          onClick={submit}
          className="mt-6 w-full rounded bg-brand py-3 text-base font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Abriendo…' : 'Iniciar / Continuar cierre'}
        </button>
      </div>
    </div>
  );
}
