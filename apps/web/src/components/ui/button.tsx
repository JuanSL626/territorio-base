import { SpinnerIcon } from './icons';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '~/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover border border-transparent',
  secondary:
    'bg-surface text-fg border border-border-base hover:bg-surface-3 disabled:hover:bg-surface',
  ghost: 'bg-transparent text-fg border border-transparent hover:bg-surface-3',
  danger: 'bg-danger text-white border border-transparent hover:opacity-90',
  inverse:
    'bg-transparent text-fg-inverse border border-white/20 hover:bg-white/10 disabled:hover:bg-transparent',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-12 gap-1',
  md: 'h-8 px-3 text-13 gap-1.5',
  lg: 'h-11 px-4 text-13 gap-2',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  fullWidth?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  leadingIcon,
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading ? true : undefined}
      className={cn(
        'rounded-btn inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        fullWidth ? 'w-full' : null,
        className,
      )}
      {...props}
    >
      {loading ? <SpinnerIcon size={14} /> : leadingIcon}
      {children}
    </button>
  );
}

export type IconButtonProps = Omit<ButtonProps, 'leadingIcon' | 'children' | 'fullWidth'> & {
  /** Obligatorio: todo control necesita nombre accesible (§13). */
  label: string;
  icon: ReactNode;
  showLabel?: boolean;
};

export function IconButton({
  label,
  icon,
  showLabel = false,
  variant = 'ghost',
  className,
  disabled,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        'rounded-btn inline-flex flex-col items-center justify-center gap-0.5',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        showLabel ? 'h-auto min-h-10 w-10 px-1 py-1' : 'h-7 w-7',
        className,
      )}
      {...props}
    >
      {icon}
      {showLabel ? <span className="text-11 leading-none font-medium">{label}</span> : null}
    </button>
  );
}
