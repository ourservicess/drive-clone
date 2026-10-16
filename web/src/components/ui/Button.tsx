import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const styles: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 disabled:bg-brand-500/60',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60',
  ghost: 'text-brand-600 hover:bg-brand-50 disabled:opacity-60',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/60',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export function Button({ variant = 'primary', loading = false, className = '', children, disabled, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

/** Round icon-only button. `label` is required for screen readers. */
export function IconButton({
  label,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-200/70 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}
