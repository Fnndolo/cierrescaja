import { useEffect, useState } from 'react';
import { formatCOP, parseCOPInput } from '../lib/format';

type Props = {
  value: number | undefined;
  onChange: (n: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

export default function MoneyInput({ value, onChange, placeholder, className = '', disabled }: Props) {
  const [text, setText] = useState<string>(value ? formatCOP(value) : '');

  useEffect(() => {
    const target = value ? formatCOP(value) : '';
    setText((t) => (parseCOPInput(t) === Number(value) ? t : target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      inputMode="numeric"
      pattern="[0-9]*"
      disabled={disabled}
      className={`w-full rounded border border-slate-300 px-3 py-2 text-right text-base focus:border-accent focus:outline-none disabled:bg-slate-100 ${className}`}
      placeholder={placeholder || '$ 0'}
      value={text}
      onChange={(e) => {
        const n = parseCOPInput(e.target.value);
        setText(n ? formatCOP(n) : '');
        onChange(n);
      }}
      onFocus={(e) => e.currentTarget.select()}
    />
  );
}
