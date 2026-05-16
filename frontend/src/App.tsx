import { useEffect, useState } from 'react';
import SedeFechaPicker from './components/SedeFechaPicker';
import ClosingForm from './components/ClosingForm';

const CTX_KEY = 'cierre-ctx';

function loadCtx(): { sede: string; fecha: string } | null {
  try {
    const raw = sessionStorage.getItem(CTX_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [ctx, setCtx] = useState<{ sede: string; fecha: string } | null>(loadCtx);

  // Persiste la sede/fecha actual para sobrevivir recargas o que el navegador
  // movil "purgue" la pagina cuando se abre la camara.
  useEffect(() => {
    if (ctx) sessionStorage.setItem(CTX_KEY, JSON.stringify(ctx));
    else sessionStorage.removeItem(CTX_KEY);
  }, [ctx]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {!ctx ? (
        <SedeFechaPicker onReady={(sede, fecha) => setCtx({ sede, fecha })} />
      ) : (
        <ClosingForm
          sede={ctx.sede}
          fecha={ctx.fecha}
          onBack={() => setCtx(null)}
        />
      )}
    </div>
  );
}
