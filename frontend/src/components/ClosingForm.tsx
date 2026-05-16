import { useEffect, useMemo, useState } from 'react';
import EntradasSection from './EntradasSection';
import GastosTable from './GastosTable';
import ComprobantesGallery from './ComprobantesGallery';
import ConteoEfectivo from './ConteoEfectivo';
import PhotoCapture from './PhotoCapture';
import ReconciliationPanel from './ReconciliationPanel';
import Section from './Section';
import { api } from '../lib/api';
import { useAutoSave } from '../hooks/useAutoSave';
import { BILLETES, MONEDAS, ENTRADAS_KEYS, type Closing, type ClosingPhoto, type Conteo, type Gasto } from '../lib/types';
import { formatCOP, nowHHMM, sumObjectValues } from '../lib/format';

function sumConteo(conteo: Conteo | undefined): number {
  if (!conteo) return 0;
  let s = 0;
  for (const d of BILLETES) s += (Number(conteo.billetes?.[String(d)]) || 0) * d;
  for (const d of MONEDAS) s += (Number(conteo.monedas?.[String(d)]) || 0) * d;
  return s;
}

type Props = {
  sede: string;
  fecha: string;
  onBack: () => void;
};

type ClosingWithSugg = Closing & {
  saldo_anterior_sugerido?: { fuente: 'db'; fecha: string; total: number } | null;
};

export default function ClosingForm({ sede, fecha, onBack }: Props) {
  const [closing, setClosing] = useState<ClosingWithSugg | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [prefillStatus, setPrefillStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [prefillInfo, setPrefillInfo] = useState<string | null>(null);

  // bootstrap del cierre
  useEffect(() => {
    api.getOrCreateClosing(sede, fecha).then((c) => setClosing(c as ClosingWithSugg))
      .catch((e) => setLoadErr(e.message));
  }, [sede, fecha]);

  // Cuando el usuario vuelve a la pestania (p.ej. tras tomar una foto en el celular y volver),
  // recargamos solo las fotos del cierre, por si la subida termino en background y aun no la vemos.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      if (!closing) return;
      api.getClosingBySedeFecha(sede, fecha)
        .then((c) => { if (c) setPhotos((c as any).photos || []); })
        .catch(() => {});
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [closing?.id, sede, fecha]);

  // estado local editable
  const [hora, setHora] = useState<string>('');
  const [responsable, setResponsable] = useState<string>('');
  const [saldoAnterior, setSaldoAnterior] = useState<number>(0);
  const [entradas, setEntradas] = useState<Record<string, number>>({});
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [conteo, setConteo] = useState<Conteo>({});
  const [photos, setPhotos] = useState<ClosingPhoto[]>([]);
  const [autofilling, setAutofilling] = useState(false);

  // cargar valores del cierre traido
  useEffect(() => {
    if (!closing) return;
    setHora(closing.hora?.toString().slice(0, 5) || nowHHMM());
    setResponsable(closing.responsable || '');
    setSaldoAnterior(Number(closing.saldo_anterior) || 0);
    setEntradas(closing.entradas || {});
    setGastos(closing.gastos || []);
    setConteo(closing.conteo || {});
    setPhotos(closing.photos || []);
  }, [closing?.id]);

  // Merge para refresh MANUAL: sincroniza completamente con Alegra.
  // - Gastos manuales del usuario (sin alegra_payment_id): se conservan
  // - Gastos que vienen de Alegra: se usa SOLO la version remota actual
  //   (los borrados en Alegra desaparecen, los editados manualmente se sobreescriben)
  function mergeGastos(local: Gasto[], remote: Gasto[]): Gasto[] {
    const manual = local.filter(g => !g.alegra_payment_id);
    return [...remote, ...manual];
  }

  // Merge para refresh SILENCIOSO (polling): sincroniza con Alegra preservando ediciones.
  // - Gastos manuales del usuario: se conservan
  // - Gastos de Alegra aun presentes en remote: se conserva la version LOCAL (preserva tus ediciones)
  // - Gastos de Alegra que ya NO estan en remote (borrados en Alegra): se eliminan
  // - Gastos nuevos en remote: se agregan
  function syncGastosSilent(local: Gasto[], remote: Gasto[]): Gasto[] {
    const remoteIds = new Set(remote.map(r => r.alegra_payment_id).filter(Boolean));
    const kept = local.filter(g => !g.alegra_payment_id || remoteIds.has(g.alegra_payment_id));
    const keptIds = new Set(kept.map(g => g.alegra_payment_id).filter(Boolean));
    const nuevos = remote.filter(r => r.alegra_payment_id && !keptIds.has(r.alegra_payment_id));
    // Si no hay cambios efectivos, retorna la misma referencia para no triggear re-render
    if (kept.length === local.length && nuevos.length === 0) return local;
    return [...kept, ...nuevos];
  }

  // Auto-prefill desde Alegra al abrir un cierre que esta vacio
  useEffect(() => {
    if (!closing) return;
    if (closing.estado === 'finalizado') return;
    const isFresh = Number(closing.saldo_anterior) === 0
                  && Object.keys(closing.entradas || {}).length === 0
                  && (!closing.gastos || closing.gastos.length === 0);
    if (!isFresh) return;

    let cancelled = false;
    setPrefillStatus('loading');
    setPrefillError(null);
    setPrefillInfo(null);
    api.getAlegraPrefill(sede, fecha)
      .then((data) => {
        if (cancelled) return;
        const fromDb = closing.saldo_anterior_sugerido;
        if (fromDb && fromDb.total > 0) {
          setSaldoAnterior(fromDb.total);
          setPrefillInfo(`Saldo anterior tomado del cierre del ${fromDb.fecha?.toString().slice(0,10)}`);
        } else if (data.saldo_anterior_sugerido > 0) {
          setSaldoAnterior(data.saldo_anterior_sugerido);
          setPrefillInfo('Saldo anterior tomado de "Apertura de turno" en Alegra');
        }
        setEntradas((prev) => ({ ...prev, ...data.entradas }));
        setGastos(data.gastos || []);
        setPrefillStatus('done');
      })
      .catch((e) => {
        if (cancelled) return;
        setPrefillStatus('error');
        setPrefillError(e.message);
      });
    return () => { cancelled = true; };
  }, [closing?.id]);

  // Polling silencioso cada 60s mientras el cierre esta abierto y la pestaña visible.
  // - Gastos: solo agrega los nuevos (preserva tus ediciones)
  // - Entradas (venta_factura_pos, otros_ingresos): refleja los nuevos totales de Alegra
  // - Saldo anterior: NO se actualiza por polling (es el cash que arrastras de ayer y no
  //   deberia cambiar a lo largo del dia). Si necesitas refrescarlo, usa el boton manual.
  useEffect(() => {
    if (!closing) return;
    if (closing.estado === 'finalizado') return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      api.getAlegraPrefill(sede, fecha)
        .then((data) => {
          if (cancelled) return;
          setGastos((prev) => syncGastosSilent(prev, data.gastos || []));
          setEntradas((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const [k, v] of Object.entries(data.entradas || {})) {
              const nv = Number(v) || 0;
              const cv = Number(prev[k]) || 0;
              if (cv !== nv) {
                next[k] = nv;
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        })
        .catch(() => { /* silencioso */ });
    };
    const interval = window.setInterval(tick, 60_000);
    return () => { cancelled = true; window.clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing?.id, sede, fecha]);

  const isFinalized = closing?.estado === 'finalizado';
  const dirtyPayload = useMemo(() => ({
    hora, responsable, saldo_anterior: saldoAnterior, entradas, gastos, conteo,
  }), [hora, responsable, saldoAnterior, entradas, gastos, conteo]);

  const { status: saveStatus, error: saveError } = useAutoSave(
    dirtyPayload,
    async (v) => {
      if (!closing) return;
      if (isFinalized) return;
      await api.patchClosing(closing.id, v as any);
    },
    900,
  );

  const totalEntradas = sumObjectValues(entradas, ENTRADAS_KEYS as any);
  const totalGastos = gastos.reduce((a, g) => a + (Number(g.valor) || 0), 0);
  const totalEfectivoEsperado = saldoAnterior + totalEntradas - totalGastos;
  const totalArqueo = sumConteo(conteo);
  const faltanteSobrante = totalArqueo - totalEfectivoEsperado;
  const cuadrado = Math.abs(faltanteSobrante) < 1;

  const autoFromAlegra = async () => {
    if (!closing) return;
    setAutofilling(true);
    setPrefillStatus('loading');
    setPrefillError(null);
    try {
      const data = await api.getAlegraPrefill(sede, fecha);
      if (data.saldo_anterior_sugerido > 0 && saldoAnterior === 0) {
        setSaldoAnterior(data.saldo_anterior_sugerido);
      }
      setEntradas((prev) => ({ ...prev, ...data.entradas }));
      setGastos((prev) => mergeGastos(prev, data.gastos || []));
      setPrefillStatus('done');
      setPrefillInfo('Datos actualizados desde Alegra');
    } catch (e: any) {
      setPrefillStatus('error');
      setPrefillError(e.message);
    } finally {
      setAutofilling(false);
    }
  };

  const [finalizing, setFinalizing] = useState(false);
  const [driveLinks, setDriveLinks] = useState<{ folderId?: string; excel?: { id: string; webViewLink?: string } } | null>(null);

  const finalize = async () => {
    if (!closing) return;
    if (!cuadrado) {
      const ok = confirm(`Hay un descuadre de ${formatCOP(faltanteSobrante)}. ¿Finalizar de todos modos?`);
      if (!ok) return;
    }
    setFinalizing(true);
    try {
      const r = await api.finalizeClosing(closing.id);
      setClosing(r.closing as ClosingWithSugg);
      setDriveLinks(r.drive);
    } catch (e: any) {
      alert('Error finalizando: ' + e.message);
    } finally {
      setFinalizing(false);
    }
  };

  const reopen = async () => {
    if (!closing) return;
    if (!confirm('Reabrir el cierre para editar?')) return;
    try {
      const r = await api.reopenClosing(closing.id);
      setClosing(r as ClosingWithSugg);
      setDriveLinks(null);
    } catch (e: any) {
      alert(e.message);
    }
  };

  if (loadErr) {
    return <div className="p-4 text-red-700">Error: {loadErr}</div>;
  }
  if (!closing) {
    return <div className="p-4 text-slate-600">Cargando cierre…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-3 pb-32">
      {/* Header */}
      <div className="sticky top-0 z-10 -mx-3 mb-3 border-b border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="text-sm text-slate-500">← Cambiar</button>
          <div className="text-center">
            <div className="text-xs uppercase text-slate-500">{sede}</div>
            <div className="text-sm font-semibold">{fecha}</div>
          </div>
          <div className="text-right text-[10px] leading-tight">
            <div className={
              saveStatus === 'error' ? 'text-red-600' :
              saveStatus === 'saving' ? 'text-amber-600' :
              saveStatus === 'saved' ? 'text-emerald-600' : 'text-slate-400'
            }>
              {saveStatus === 'error' ? 'Error' : saveStatus === 'saving' ? 'Guardando…' : saveStatus === 'saved' ? 'Guardado' : '—'}
            </div>
            <div className={isFinalized ? 'font-bold text-emerald-700' : 'text-slate-500'}>
              {isFinalized ? 'FINALIZADO' : 'borrador'}
            </div>
          </div>
        </div>
        {/* Resumen de cuadre */}
        <div className={`mt-2 rounded px-2 py-1 text-xs font-medium ${cuadrado ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {cuadrado
            ? `Caja cuadrada · efectivo: ${formatCOP(totalArqueo)}`
            : `Descuadre: ${formatCOP(faltanteSobrante)} (esperado ${formatCOP(totalEfectivoEsperado)}, contado ${formatCOP(totalArqueo)})`}
        </div>
        {saveError && <div className="mt-1 text-[10px] text-red-600">{saveError}</div>}
        {prefillStatus === 'loading' && (
          <div className="mt-1 rounded bg-blue-50 px-2 py-1 text-[11px] text-blue-700">
            Consultando Alegra… (puede tardar 20-40s)
          </div>
        )}
        {prefillStatus === 'done' && prefillInfo && (
          <div className="mt-1 rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
            {prefillInfo}
          </div>
        )}
        {prefillStatus === 'error' && (
          <div className="mt-1 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">
            Error consultando Alegra: {prefillError}
          </div>
        )}
      </div>

      {/* Datos basicos */}
      <Section title="Datos básicos" defaultOpen>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-600">Hora</label>
            <input type="time" value={hora} disabled={isFinalized}
              onChange={(e) => setHora(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-600">Responsable</label>
            <input type="text" value={responsable} disabled={isFinalized}
              onChange={(e) => setResponsable(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
        </div>
      </Section>

      <EntradasSection
        entradas={entradas}
        onChange={setEntradas}
        onAutofill={autoFromAlegra}
        autofillLoading={autofilling}
        saldoAnterior={saldoAnterior}
        onSaldoAnteriorChange={setSaldoAnterior}
        disabled={isFinalized}
      />

      <GastosTable gastos={gastos} onChange={setGastos} disabled={isFinalized} />

      <ComprobantesGallery
        closingId={closing.id}
        photos={photos}
        onChange={setPhotos}
        disabled={isFinalized}
      />

      <ConteoEfectivo conteo={conteo} onChange={setConteo} disabled={isFinalized} />

      <Section title="Foto / archivo del cierre del turno">
        <PhotoCapture
          label="Pantallazo, foto o archivo del cierre"
          uploadedId={closing.drive_closing_photo_id}
          disabled={isFinalized}
          allowFiles
          onUpload={async (file) => {
            const r = await api.uploadClosingPhoto(closing.id, file);
            setClosing((c) => c ? { ...c, drive_closing_photo_id: r.file.id } : c);
            return r.file;
          }}
        />
      </Section>

      <ReconciliationPanel sede={sede} fecha={fecha} />

      {/* Resumen final */}
      <Section title="Resumen" defaultOpen>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt>Saldo anterior</dt><dd>{formatCOP(saldoAnterior)}</dd></div>
          <div className="flex justify-between"><dt>Total entradas</dt><dd>{formatCOP(totalEntradas)}</dd></div>
          <div className="flex justify-between"><dt>Total gastos comprobantes</dt><dd>{formatCOP(totalGastos)}</dd></div>
          <div className="flex justify-between border-t pt-1"><dt>Efectivo esperado</dt><dd>{formatCOP(totalEfectivoEsperado)}</dd></div>
          <div className="flex justify-between"><dt>Total arqueo</dt><dd>{formatCOP(totalArqueo)}</dd></div>
          <div className={`flex justify-between font-semibold ${cuadrado ? 'text-emerald-700' : 'text-red-700'}`}>
            <dt>Faltante / Sobrante</dt><dd>{formatCOP(faltanteSobrante)}</dd>
          </div>
        </dl>
      </Section>

      {/* Bottom action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white p-3 shadow-lg">
        <div className="mx-auto flex max-w-2xl gap-2">
          {!isFinalized ? (
            <button
              type="button"
              disabled={finalizing}
              onClick={finalize}
              className="flex-1 rounded bg-brand py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {finalizing ? 'Generando…' : 'Finalizar y subir a Drive'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={reopen}
                className="flex-1 rounded border border-slate-300 py-3 text-sm font-semibold text-slate-700"
              >Reabrir</button>
              {(driveLinks?.excel?.webViewLink || closing.drive_excel_id) && (
                <a
                  href={driveLinks?.excel?.webViewLink || `https://drive.google.com/file/d/${closing.drive_excel_id}/view`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 rounded bg-emerald-600 py-3 text-center text-sm font-semibold text-white"
                >Ver Excel en Drive</a>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
