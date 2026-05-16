import Section from './Section';
import { BILLETES, MONEDAS, type Conteo } from '../lib/types';
import { formatCOP } from '../lib/format';

type Props = {
  conteo: Conteo;
  onChange: (next: Conteo) => void;
  disabled?: boolean;
};

function sumGroup(group: Record<string, number> | undefined, denoms: readonly number[]) {
  if (!group) return 0;
  return denoms.reduce((acc, d) => acc + (Number(group[String(d)]) || 0) * d, 0);
}

export default function ConteoEfectivo({ conteo, onChange, disabled }: Props) {
  const setBillete = (d: number, cant: number) => {
    onChange({ ...conteo, billetes: { ...(conteo.billetes || {}), [d]: cant } });
  };
  const setMoneda = (d: number, cant: number) => {
    onChange({ ...conteo, monedas: { ...(conteo.monedas || {}), [d]: cant } });
  };
  const totalBilletes = sumGroup(conteo.billetes, BILLETES);
  const totalMonedas = sumGroup(conteo.monedas, MONEDAS);
  const total = totalBilletes + totalMonedas;

  return (
    <Section title="Conteo del efectivo" subtitle={<span>Total arqueo: <b>{formatCOP(total)}</b></span>}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Billetes</h3>
          <div className="space-y-2">
            {BILLETES.map((d) => {
              const cant = Number(conteo.billetes?.[String(d)]) || 0;
              return (
                <div key={d} className="grid grid-cols-12 items-center gap-2">
                  <span className="col-span-4 text-xs text-slate-600">{formatCOP(d)}</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="col-span-3 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                    value={cant || ''}
                    disabled={disabled}
                    onChange={(e) => setBillete(d, Number(e.target.value) || 0)}
                  />
                  <span className="col-span-5 text-right text-xs text-slate-500">{formatCOP(cant * d)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between border-t border-slate-200 pt-2 text-sm font-medium">
            <span>Total billetes</span>
            <span>{formatCOP(totalBilletes)}</span>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Monedas</h3>
          <div className="space-y-2">
            {MONEDAS.map((d) => {
              const cant = Number(conteo.monedas?.[String(d)]) || 0;
              return (
                <div key={d} className="grid grid-cols-12 items-center gap-2">
                  <span className="col-span-4 text-xs text-slate-600">{formatCOP(d)}</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="col-span-3 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                    value={cant || ''}
                    disabled={disabled}
                    onChange={(e) => setMoneda(d, Number(e.target.value) || 0)}
                  />
                  <span className="col-span-5 text-right text-xs text-slate-500">{formatCOP(cant * d)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between border-t border-slate-200 pt-2 text-sm font-medium">
            <span>Total monedas</span>
            <span>{formatCOP(totalMonedas)}</span>
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-between border-t border-slate-300 pt-3 text-base font-bold text-brand">
        <span>Total arqueo (billetes + monedas)</span>
        <span>{formatCOP(total)}</span>
      </div>
    </Section>
  );
}
