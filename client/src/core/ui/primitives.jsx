import { useState, useEffect } from 'react';
import { IconClose, IconAlertTriangle, IconCheck } from '../icons/Icons.jsx';

const buttonVariants = {
  primary: 'border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 shadow-[0_4px_10px_rgba(37,99,235,0.18)] hover:shadow-[0_6px_14px_rgba(37,99,235,0.22)] active:scale-[0.99]',
  subtle: 'border border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/60 hover:text-blue-700 shadow-2xs active:scale-[0.99]',
  danger: 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:border-rose-300 active:scale-[0.99]',
  success: 'border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs active:scale-[0.99]',
};

const buttonSizes = {
  sm: 'min-h-8 px-3 text-[11px] rounded-lg',
  md: 'min-h-9 px-4 text-xs rounded-lg',
  lg: 'min-h-11 px-5 text-sm rounded-xl',
};

const badgeTones = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  neutral: 'border-slate-200 bg-slate-100 text-slate-700',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-800',
};

export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', children, ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer ${buttonVariants[variant] || buttonVariants.primary} ${buttonSizes[size] || buttonSizes.md} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function SectionTabs({ tabs, value, onChange, label, variant = 'underline' }) {
  if (variant === 'pills') {
    return (
      <nav className="flex items-center gap-1.5 overflow-x-auto p-1 bg-slate-100/90 rounded-xl border border-slate-200/80 scrollbar-none" role="tablist" aria-label={label}>
        {tabs.map((tab) => {
          const active = value === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.id)}
              className={`relative inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs transition-all duration-150 cursor-pointer ${
                active
                  ? 'bg-white text-slate-900 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60 font-medium'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${active ? 'bg-blue-50 text-blue-700 border border-blue-200/60' : 'bg-slate-200/80 text-slate-600'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex gap-7 overflow-x-auto border-b border-slate-200/90 scrollbar-none" role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`relative min-h-10 shrink-0 border-b-2 px-1 text-xs transition-colors cursor-pointer inline-flex items-center gap-2 pb-2.5 pt-0.5 ${
              active
                ? 'border-blue-600 text-blue-700 font-semibold'
                : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900 font-medium'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                active
                  ? 'bg-blue-50 text-blue-700 border border-blue-200/70'
                  : 'bg-slate-100 text-slate-600 border border-slate-200/70'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function MetricStrip({ items, label, className = '' }) {
  const colClass = items.length === 4
    ? 'grid-cols-2 lg:grid-cols-4'
    : items.length === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : 'grid-cols-1 sm:grid-cols-3';

  const getToneClass = (tone) => {
    switch (tone) {
      case 'blue': return 'text-blue-700';
      case 'amber': return 'text-amber-600';
      case 'rose': return 'text-rose-600';
      case 'emerald': return 'text-emerald-700';
      default: return 'text-slate-900';
    }
  };

  return (
    <section className={`overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_8px_24px_rgba(45,77,128,0.055)] ${className}`} aria-label={label}>
      <div className={`grid ${colClass} divide-y divide-slate-100 sm:divide-x sm:divide-y-0`}>
        {items.map((item) => (
          <div key={item.label} className="flex flex-col justify-center gap-1.5 px-5 py-4 sm:min-h-[74px] sm:px-6">
            <span className="text-xs font-medium text-slate-500">{item.label}</span>
            <div className="flex items-baseline gap-2">
              <strong className={`text-2xl font-bold leading-none tracking-tight tabular-nums ${getToneClass(item.tone)}`}>
                {item.value}
              </strong>
              {item.detail && <span className="text-[11px] text-slate-400 font-normal">{item.detail}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function WorkspacePanel({ title, description, actions, children, className = '' }) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_8px_24px_rgba(45,77,128,0.055)] ${className}`}>
      <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-3.5 sm:px-6 bg-[#fbfcfe]">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mb-0 mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function StatCard({ label, value, detail, icon: Icon, tone = 'blue' }) {
  const iconTone = tone === 'teal'
    ? 'border-teal-100 bg-teal-50 text-teal-700 group-hover:bg-teal-100'
    : tone === 'neutral'
      ? 'border-slate-200 bg-slate-50 text-slate-600 group-hover:bg-slate-100'
      : 'border-blue-100 bg-blue-50 text-blue-700 group-hover:bg-blue-100';
  const cardTone = tone === 'teal' ? 'border-teal-100 bg-[#f5faf8]' : tone === 'neutral' ? 'border-slate-200 bg-white' : 'border-blue-100 bg-white';

  return (
    <article className={`group relative min-w-0 overflow-hidden rounded-lg border p-4 shadow-[0_2px_8px_rgba(20,30,50,0.035)] transition-[border-color,box-shadow] ${cardTone} hover:shadow-[0_4px_12px_rgba(20,30,50,0.06)] sm:p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-0 text-xs font-semibold tracking-[.01em] text-slate-600">{label}</p>
          <p className="mb-0 mt-3 text-[32px] font-bold leading-none tracking-[-.04em] text-slate-900 tabular-nums">{value}</p>
        </div>
        <span className={`grid size-10 shrink-0 place-items-center rounded-lg border transition-colors ${iconTone}`} aria-hidden="true">
          <Icon className="size-[18px]" />
        </span>
      </div>
      {detail && <p className="mb-0 mt-3 text-xs text-slate-500">{detail}</p>}
    </article>
  );
}

export function StatusBadge({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold leading-none ${badgeTones[tone] || badgeTones.neutral} ${className}`}>
      {children}
    </span>
  );
}

/**
 * Production-grade alert and toast banner.
 */
export function ToastBanner({ notice, onDismiss }) {
  if (!notice || !notice.message) return null;

  const styles = {
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-blue-200 bg-blue-50 text-blue-900',
  };

  const currentStyle = styles[notice.type] || styles.info;

  return (
    <div className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs shadow-xs transition-all ${currentStyle}`}>
      <div className="flex items-start gap-2.5">
        {notice.type === 'error' || notice.type === 'warning' ? (
          <IconAlertTriangle className="size-4 shrink-0 mt-0.5" />
        ) : notice.type === 'success' ? (
          <IconCheck className="size-4 shrink-0 mt-0.5 text-emerald-600" />
        ) : (
          <span className="size-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
        )}
        <div className="space-y-0.5">
          <div className="font-semibold">{notice.message}</div>
          {notice.detail && notice.detail !== notice.message && (
            <div className="text-[11px] opacity-90 leading-relaxed">{notice.detail}</div>
          )}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
          aria-label="Dismiss alert"
        >
          <IconClose className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Production-grade modal confirmation dialog replacing window.confirm().
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
  loading = false,
  children,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
        <div className="flex items-center gap-3">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-xl ${
              tone === 'danger'
                ? 'bg-rose-100 text-rose-700'
                : tone === 'warning'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-blue-100 text-blue-700'
            }`}
          >
            <IconAlertTriangle className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 leading-snug">{title}</h3>
            {message && <p className="text-xs text-slate-500 mt-1">{message}</p>}
          </div>
        </div>

        {children && <div className="text-xs text-slate-600">{children}</div>}

        <div className="pt-2 flex justify-end gap-2.5 border-t border-slate-100">
          <Button variant="subtle" size="sm" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Processing…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Production-grade input prompt dialog replacing window.prompt().
 */
export function PromptDialog({
  isOpen,
  title,
  message,
  placeholder = '',
  initialValue = '',
  confirmLabel = 'Submit',
  cancelLabel = 'Cancel',
  presets = [],
  onConfirm,
  onCancel,
  loading = false,
}) {
  const [value, setValue] = useState(initialValue);
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    setValue(initialValue);
    setValidationError('');
  }, [isOpen, initialValue]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!value.trim()) {
      setValidationError('Please provide a response before submitting.');
      return;
    }
    onConfirm(value.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-900 leading-snug">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <IconClose className="size-4" />
          </button>
        </div>

        {message && <p className="text-xs text-slate-600 leading-relaxed">{message}</p>}

        {presets.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Quick Suggestions:</span>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setValue(preset);
                    setValidationError('');
                  }}
                  className="rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition cursor-pointer"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            required
            rows={3}
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (validationError) setValidationError('');
            }}
            className="w-full rounded-lg border border-slate-300 p-3 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          />

          {validationError && (
            <p className="text-xs text-rose-600 font-semibold">{validationError}</p>
          )}

          <div className="pt-2 flex justify-end gap-2.5 border-t border-slate-100">
            <Button variant="subtle" size="sm" onClick={onCancel} disabled={loading}>
              {cancelLabel}
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={loading || !value.trim()}>
              {loading ? 'Submitting…' : confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
