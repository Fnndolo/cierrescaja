const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

export function formatCOP(n: number | string | null | undefined): string {
  const v = Number(n) || 0;
  return cop.format(v);
}

export function parseCOPInput(raw: string): number {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[^\d]/g, '');
  return cleaned ? Number(cleaned) : 0;
}

export function todayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function sumObjectValues(obj: Record<string, number> | undefined, keys: readonly string[] = []): number {
  if (!obj) return 0;
  const arr = keys.length ? keys.map((k) => obj[k]) : Object.values(obj);
  return arr.reduce<number>((acc, v) => acc + (Number(v) || 0), 0);
}
