import { useEffect, useRef, useState } from 'react';

export function useAutoSave<T>(value: T, save: (v: T) => Promise<unknown>, delayMs = 800) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setStatus('saving');
      try {
        await save(value);
        setStatus('saved');
        setError(null);
      } catch (e: any) {
        setStatus('error');
        setError(e.message || 'Error guardando');
      }
    }, delayMs);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return { status, error };
}
