// Design-system primitives: chunky Duolingo-energy buttons, cards, bars.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost' | 'locked';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-marigold text-white border-b-4 border-marigold-dark hover:brightness-105 active:border-b-0 active:translate-y-1',
  secondary:
    'bg-teal text-white border-b-4 border-teal-dark hover:brightness-110 active:border-b-0 active:translate-y-1',
  success:
    'bg-success text-white border-b-4 border-success-dark hover:brightness-105 active:border-b-0 active:translate-y-1',
  danger:
    'bg-error text-white border-b-4 border-error-dark hover:brightness-105 active:border-b-0 active:translate-y-1',
  ghost:
    'bg-card text-ink border-2 border-b-4 border-line hover:bg-line/40 active:border-b-2 active:translate-y-0.5',
  locked: 'bg-locked text-white/70 cursor-not-allowed',
};

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`rounded-2xl px-5 py-3 font-bold uppercase tracking-wide transition-all duration-100 disabled:opacity-50 disabled:pointer-events-none select-none ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`bg-card rounded-3xl border-2 border-line p-5 ${className}`}>{children}</div>
  );
}

export function ProgressBar({
  pct,
  color = 'bg-marigold',
  className = '',
}: {
  pct: number;
  color?: string;
  className?: string;
}) {
  return (
    <div className={`h-4 rounded-full bg-line overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full ${color} transition-all duration-500 ease-out`}
        style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }}
      />
    </div>
  );
}

export function Chip({
  tone,
  children,
}: {
  tone: 'success' | 'error' | 'warn' | 'neutral';
  children: ReactNode;
}) {
  const tones = {
    success: 'bg-success-soft text-success-dark border-success',
    error: 'bg-error-soft text-error-dark border-error',
    warn: 'bg-amber-soft text-marigold-dark border-marigold',
    neutral: 'bg-teal-soft text-teal border-teal/40',
  } as const;
  return (
    <span className={`inline-block rounded-xl border-2 px-2.5 py-1 text-sm font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}
