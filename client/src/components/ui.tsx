import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, CircleCheck, Info, LoaderCircle, Minus, Plus, RefreshCw, Star, TriangleAlert, X } from 'lucide-react';
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  discountPercent,
  formatINR,
  type OrderPaymentStatus,
  type OrderStatus,
  type PageMeta,
} from '@shop/shared';
import { errorMessage } from '../services/api';
import { useToasts } from '../store/local';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ---------------------------------------------------------------- buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm disabled:bg-brand-700/50',
  secondary: 'bg-stone-900 text-white hover:bg-stone-800 shadow-sm disabled:bg-stone-400',
  outline: 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 disabled:text-stone-400',
  ghost: 'text-stone-700 hover:bg-stone-100 disabled:text-stone-400',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm disabled:bg-rose-300',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const sizes = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2' };
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
        sizes[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ to, variant = 'primary', className, children }: { to: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={cx('inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors', VARIANTS[variant], className)}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- form fields

interface FieldProps {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(function Input(
  { label, error, hint, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-stone-700">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined}
        className={cx(
          'block h-10 w-full rounded-lg border bg-white px-3 text-sm shadow-sm placeholder:text-stone-400 focus:outline-none focus:ring-2',
          error ? 'border-rose-400 focus:ring-rose-200' : 'border-stone-300 focus:border-brand-600 focus:ring-brand-100',
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-err`} className="mt-1 text-xs text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-stone-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(function Textarea(
  { label, error, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-stone-700">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error)}
        className={cx(
          'block w-full rounded-lg border bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2',
          error ? 'border-rose-400 focus:ring-rose-200' : 'border-stone-300 focus:border-brand-600 focus:ring-brand-100',
        )}
        {...rest}
      />
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps>(function Select(
  { label, error, className, id, children, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-stone-700">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error)}
        className={cx(
          'block h-10 w-full rounded-lg border bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2',
          error ? 'border-rose-400 focus:ring-rose-200' : 'border-stone-300 focus:border-brand-600 focus:ring-brand-100',
        )}
        {...rest}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
});

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-stone-700">
      <input type="checkbox" className="size-4 rounded border-stone-300 accent-brand-700" {...rest} />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------- surfaces

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-stone-200 bg-white shadow-sm', className)}>{children}</div>;
}

export function Badge({ tone = 'stone', children, className }: { tone?: 'stone' | 'green' | 'amber' | 'red' | 'blue' | 'brand' | 'violet'; children: ReactNode; className?: string }) {
  const tones = {
    stone: 'bg-stone-100 text-stone-700 ring-stone-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    red: 'bg-rose-50 text-rose-700 ring-rose-200',
    blue: 'bg-sky-50 text-sky-700 ring-sky-200',
    brand: 'bg-brand-50 text-brand-800 ring-brand-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>{children}</span>;
}

const ORDER_TONES: Record<OrderStatus, Parameters<typeof Badge>[0]['tone']> = {
  pending_payment: 'amber',
  confirmed: 'blue',
  processing: 'violet',
  shipped: 'brand',
  delivered: 'green',
  cancelled: 'stone',
  expired: 'stone',
  undelivered: 'red',
};
const PAYMENT_TONES: Record<OrderPaymentStatus, Parameters<typeof Badge>[0]['tone']> = {
  unpaid: 'amber',
  paid: 'green',
  refund_pending: 'violet',
  partially_refunded: 'violet',
  refunded: 'stone',
  refund_failed: 'red',
};
export const OrderStatusBadge = ({ status }: { status: OrderStatus }) => <Badge tone={ORDER_TONES[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
export const PaymentStatusBadge = ({ status }: { status: OrderPaymentStatus }) => <Badge tone={PAYMENT_TONES[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>;

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-2xl p-0 shadow-2xl backdrop:bg-stone-900/50 backdrop:backdrop-blur-sm', widths[size])}
      aria-labelledby="modal-title"
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
            <h2 id="modal-title" className="text-lg font-semibold text-stone-900">
              {title}
            </h2>
            <button onClick={onClose} className="rounded-lg p-1 text-stone-500 hover:bg-stone-100" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------- states

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx('size-5 animate-spin text-brand-700', className)} aria-label="Loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-stone-200/70', className)} />;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white px-6 py-14 text-center">
      {icon && <div className="mb-3 text-stone-400">{icon}</div>}
      <h3 className="text-base font-semibold text-stone-900">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-stone-500">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-xl border border-rose-200 bg-rose-50 px-6 py-10 text-center">
      <TriangleAlert className="mb-2 size-7 text-rose-500" />
      <p className="text-sm font-medium text-rose-800">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" icon={<RefreshCw className="size-4" />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = 'info', children, className }: { tone?: 'info' | 'warning' | 'error' | 'success'; children: ReactNode; className?: string }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-rose-200 bg-rose-50 text-rose-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  const Icon = tone === 'success' ? CircleCheck : tone === 'info' ? Info : TriangleAlert;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-2 rounded-lg border px-3 py-2.5 text-sm', tones[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Renders loading / error / empty / success for a TanStack Query result. */
export function QueryState<T>({
  query,
  loading,
  empty,
  isEmpty,
  children,
}: {
  query: { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  loading?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{loading ?? <div className="flex justify-center py-16"><Spinner className="size-7" /></div>}</>;
  if (query.isError || query.data === undefined) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (isEmpty?.(query.data) && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

export function Pagination({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  if (meta.totalPages <= 1) return null;
  return (
    <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
      <p className="text-sm text-stone-500">
        Page {meta.page} of {meta.totalPages} · {meta.total} results
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} icon={<ChevronLeft className="size-4" />}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          Next <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- commerce bits

export function PriceTag({ price, compareAt, size = 'md', from }: { price: number; compareAt?: number | null; size?: 'sm' | 'md' | 'lg'; from?: boolean }) {
  const pct = discountPercent(price, compareAt);
  const sizes = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl' };
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className={cx('font-semibold text-stone-900', sizes[size])}>
        {from && <span className="text-xs font-normal text-stone-500">from </span>}
        {formatINR(price)}
      </span>
      {pct > 0 && compareAt && (
        <>
          <span className="text-sm text-stone-400 line-through">{formatINR(compareAt)}</span>
          <span className="text-sm font-semibold text-emerald-700">{pct}% off</span>
        </>
      )}
    </div>
  );
}

export function RatingStars({ value, count, size = 'sm' }: { value: number; count?: number; size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? 'size-3.5' : 'size-5';
  return (
    <div className="flex items-center gap-1" aria-label={`Rated ${value} out of 5${count !== undefined ? `, ${count} reviews` : ''}`}>
      <div className="flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} aria-hidden className={cx(s, i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'fill-stone-200 text-stone-200')} />
        ))}
      </div>
      {count !== undefined && <span className="text-xs text-stone-500">({count})</span>}
    </div>
  );
}

export function QuantityStepper({ value, onChange, max = 10, disabled }: { value: number; onChange: (v: number) => void; max?: number; disabled?: boolean }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-stone-300 bg-white">
      <button type="button" className="p-2 text-stone-600 hover:bg-stone-50 disabled:opacity-40" onClick={() => onChange(value - 1)} disabled={disabled || value <= 1} aria-label="Decrease quantity">
        <Minus className="size-4" />
      </button>
      <span className="w-8 text-center text-sm font-medium tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" className="p-2 text-stone-600 hover:bg-stone-50 disabled:opacity-40" onClick={() => onChange(value + 1)} disabled={disabled || value >= max} aria-label="Increase quantity">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg ring-1',
            t.kind === 'success' && 'bg-stone-900 text-white ring-stone-900',
            t.kind === 'error' && 'bg-rose-600 text-white ring-rose-700',
            t.kind === 'info' && 'bg-white text-stone-800 ring-stone-200',
          )}
        >
          {t.kind === 'success' ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : t.kind === 'error' ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-stone-200 text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th scope="col" className={cx('whitespace-nowrap bg-stone-50 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-stone-500', className)}>
    {children}
  </th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx('px-4 py-3 align-middle', className)}>{children}</td>;

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Storefront Demo` : 'Storefront Demo';
  }, [title]);
}
