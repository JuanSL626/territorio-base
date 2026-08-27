import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '~/lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  leadingIcon?: ReactNode;
};

export function Input({ className, invalid = false, leadingIcon, ...props }: InputProps) {
  const input = (
    <input
      aria-invalid={invalid ? true : undefined}
      className={cn(
        'rounded-btn bg-surface text-13 text-fg h-9 w-full border px-2.5',
        'placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-55',
        invalid ? 'border-danger' : 'border-border-base',
        leadingIcon != null ? 'pl-8' : null,
        className,
      )}
      {...props}
    />
  );

  if (leadingIcon == null) return input;

  return (
    <div className="relative">
      <span className="text-fg-subtle pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2">
        {leadingIcon}
      </span>
      {input}
    </div>
  );
}

export type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
};

/** Label + control + ayuda + error, con el cableado de aria ya resuelto. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = error != null && error.length > 0;
  const hasHint = hint != null && hint.length > 0;
  const describedBy = hasError ? errorId : hasHint ? hintId : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-12 text-fg font-semibold">
        {label}
      </label>
      {children({ id, describedBy, invalid: hasError })}
      {hasHint && !hasError ? (
        <p id={hintId} className="text-11 text-fg-muted">
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} role="alert" className="text-11 text-danger font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}
