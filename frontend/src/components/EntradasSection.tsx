import MoneyInput from './MoneyInput';
import Section from './Section';
import { ENTRADAS_KEYS, ENTRADAS_LABELS } from '../lib/types';
import { formatCOP, sumObjectValues } from '../lib/format';

type Props = {
  entradas: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  onAutofill?: () => void;
  autofillLoading?: boolean;
  saldoAnterior: number;
  onSaldoAnteriorChange: (n: number) => void;
  disabled?: boolean;
};

export default function EntradasSection({ entradas, onChange, onAutofill, autofillLoading, saldoAnterior, onSaldoAnteriorChange, disabled }: Props) {
  const total = sumObjectValues(entradas, ENTRADAS_KEYS);
  return (
    <Section
      title="Entradas del día"
      subtitle={<span>Total: <b>{formatCOP(total)}</b></span>}
    >
      <div className="mb-3">
        <label className="block text-xs font-medium text-slate-600">Saldo día anterior</label>
        <MoneyInput value={saldoAnterior} onChange={onSaldoAnteriorChange} disabled={disabled} />
      </div>
      {onAutofill && (
        <button
          type="button"
          onClick={onAutofill}
          disabled={autofillLoading || disabled}
          className="mb-3 w-full rounded border border-accent bg-accent/5 px-3 py-2 text-sm font-medium text-accent disabled:opacity-50"
        >
          {autofillLoading ? 'Consultando Alegra…' : 'Refrescar desde Alegra'}
        </button>
      )}
      <div className="space-y-3">
        {ENTRADAS_KEYS.map((k) => (
          <div key={k}>
            <label className="block text-xs font-medium text-slate-600">{ENTRADAS_LABELS[k]}</label>
            <MoneyInput
              value={entradas[k]}
              onChange={(n) => onChange({ ...entradas, [k]: n })}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-between border-t border-slate-200 pt-3 text-sm font-semibold">
        <span>Total entradas</span>
        <span>{formatCOP(total)}</span>
      </div>
    </Section>
  );
}
