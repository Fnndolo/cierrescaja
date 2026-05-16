import MoneyInput from './MoneyInput';
import Section from './Section';
import type { Gasto } from '../lib/types';
import { formatCOP } from '../lib/format';

type Props = {
  gastos: Gasto[];
  onChange: (next: Gasto[]) => void;
  disabled?: boolean;
};

export default function GastosTable({ gastos, onChange, disabled }: Props) {
  const total = gastos.reduce((acc, g) => acc + (Number(g.valor) || 0), 0);

  const setRow = (i: number, patch: Partial<Gasto>) => {
    const next = gastos.map((g, idx) => (idx === i ? { ...g, ...patch } : g));
    onChange(next);
  };
  const addRow = () => onChange([...gastos, { fecha: '', cp_no: '', tercero: '', concepto: '', valor: 0 }]);
  const removeRow = (i: number) => onChange(gastos.filter((_, idx) => idx !== i));

  return (
    <Section
      title="Gastos por comprobantes de pago"
      subtitle={<span>Total: <b>{formatCOP(total)}</b></span>}
    >
      <div className="space-y-3">
        {gastos.map((g, i) => (
          <div key={i} className="rounded border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                Gasto #{i + 1}{g.alegra_payment_id ? ' · de Alegra' : ''}
              </span>
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={disabled}
                className="text-xs text-red-600 disabled:opacity-50"
              >Eliminar</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="block text-xs text-slate-600">Concepto</label>
                <input
                  type="text"
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={g.concepto || ''}
                  disabled={disabled}
                  onChange={(e) => setRow(i, { concepto: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600">Tercero</label>
                <input
                  type="text"
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={g.tercero || ''}
                  disabled={disabled}
                  onChange={(e) => setRow(i, { tercero: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600">CP N°</label>
                <input
                  type="text"
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={g.cp_no || ''}
                  disabled={disabled}
                  onChange={(e) => setRow(i, { cp_no: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-600">Valor</label>
                <MoneyInput
                  value={g.valor}
                  onChange={(n) => setRow(i, { valor: n })}
                  disabled={disabled}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addRow}
        disabled={disabled}
        className="mt-3 w-full rounded border border-dashed border-slate-300 py-2 text-sm text-slate-600 disabled:opacity-50"
      >+ Añadir gasto</button>
      <div className="mt-4 flex justify-between border-t border-slate-200 pt-3 text-sm font-semibold">
        <span>Total comprobantes de pago</span>
        <span>{formatCOP(total)}</span>
      </div>
    </Section>
  );
}
