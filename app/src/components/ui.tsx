// Design-system primitives: soft, airy surfaces with gentle depth. Component
// names and props are stable — call sites (and the e2e selectors that match
// button text) never need to change when the look does.
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost' | 'locked';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'btn-accent text-white shadow-soft hover:brightness-105 active:translate-y-[2px] active:shadow-press',
  secondary: 'btn-teal text-white shadow-soft hover:brightness-110 active:translate-y-[2px] active:shadow-press',
  success: 'btn-success text-white shadow-soft hover:brightness-105 active:translate-y-[2px] active:shadow-press',
  danger: 'btn-error text-white shadow-soft hover:brightness-105 active:translate-y-[2px] active:shadow-press',
  ghost: 'bg-card/80 text-ink border border-line shadow-soft hover:bg-line/40 active:translate-y-[1px]',
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
      className={`rounded-2xl px-5 py-3 font-extrabold tracking-wide transition-all duration-150 ease-out disabled:opacity-50 disabled:pointer-events-none select-none ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`surface p-5 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function ProgressBar({
  pct,
  color = 'btn-accent',
  className = '',
}: {
  pct: number;
  color?: string;
  className?: string;
}) {
  return (
    <div className={`h-3 rounded-full bg-line/80 overflow-hidden ${className}`}>
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
    success: 'bg-success-soft text-success-dark',
    error: 'bg-error-soft text-error-dark',
    warn: 'bg-accent-soft text-accent-dark',
    neutral: 'bg-teal-soft text-teal',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Circular progress ring (Apple-rings style). pct 0..1. */
export function Ring({
  pct,
  size = 40,
  stroke = 5,
  className = '',
  children,
  track = 'var(--c-line)',
  color = 'var(--c-accent)',
}: {
  pct: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: ReactNode;
  track?: string;
  color?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, pct));
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}

/** Gold coin glyph (SVG, no emoji so it renders the same everywhere). */
export function Coin({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="coin-g" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="0.6" stopColor="#f5a623" />
          <stop offset="1" stopColor="#c47a0c" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="11" fill="url(#coin-g)" />
      <circle cx="12" cy="12" r="8" fill="none" stroke="#fff3cf" strokeOpacity="0.7" strokeWidth="1.2" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="800" fill="#8a5300" fontFamily="Nunito, sans-serif">
        చ
      </text>
    </svg>
  );
}

export function CoinPill({ amount, onClick, className = '' }: { amount: number; onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Coins: ${amount}`}
      className={`inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-sm font-extrabold text-accent-dark shadow-press transition-transform active:scale-95 ${className}`}
    >
      <Coin size={16} />
      <span data-testid="coin-balance">{amount}</span>
    </button>
  );
}

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
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full bg-card/80 text-ink shadow-soft transition-transform active:scale-95 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
