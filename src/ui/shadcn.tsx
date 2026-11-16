import type { ReactNode } from 'react';

/* shadcn/ui-style primitives (hand-written, faithful to the official markup:
   Card/CardHeader/CardTitle/CardContent, Badge, Progress, Avatar, Separator, Button).
   Styling comes from Tailwind utility classes + theme tokens in theme.css. */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`altura-card ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children }: { children: ReactNode }) {
  return <div className="altura-card-header">{children}</div>;
}

export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h3 className={`altura-card-title ${className}`}>{children}</h3>;
}

export function CardDescription({ children }: { children: ReactNode }) {
  return <p className="altura-card-desc">{children}</p>;
}

export function CardContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`altura-card-content ${className}`}>{children}</div>;
}

export type BadgeVariant = 'default' | 'success' | 'danger' | 'outline' | 'secondary';

export function Badge({ children, variant = 'default' }: { children: ReactNode; variant?: BadgeVariant }) {
  return <span className={`altura-badge altura-badge--${variant}`}>{children}</span>;
}

export function Progress({ value, barClass = '' }: { value: number; barClass?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="altura-progress" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={`altura-progress-bar ${barClass}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Avatar({ src, fallback }: { src?: string; fallback: string }) {
  return (
    <div className="altura-avatar">
      {src ? <img className="altura-avatar-img" src={src} alt="" /> : null}
      <span className="altura-avatar-fallback">{fallback}</span>
    </div>
  );
}

export function Separator({ className = '' }: { className?: string }) {
  return <hr className={`altura-separator ${className}`} />;
}

export type ButtonVariant = 'ghost' | 'outline' | 'default';

export function Button({ children, variant = 'default', onClick, className = '' }: {
  children: ReactNode;
  variant?: ButtonVariant;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button type="button" className={`altura-btn altura-btn--${variant} ${className}`} onClick={onClick}>
      {children}
    </button>
  );
}
