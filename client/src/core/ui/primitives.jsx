const buttonVariants = {
  primary: 'border border-transparent bg-blue-700 text-white hover:bg-blue-800',
  subtle: 'border border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800',
};

const buttonSizes = {
  sm: 'min-h-8 px-3 text-[11px]',
  md: 'min-h-10 px-4 text-xs',
};

const badgeTones = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  neutral: 'border-slate-200 bg-slate-100 text-slate-600',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
};

export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', children, ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-wait disabled:opacity-60 ${buttonVariants[variant] || buttonVariants.primary} ${buttonSizes[size] || buttonSizes.md} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function SectionTabs({ tabs, value, onChange, label }) {
  return (
    <nav className="flex gap-7 overflow-x-auto border-b border-slate-200" role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`min-h-12 shrink-0 border-b-2 px-1 text-[13px] transition-colors ${active ? 'border-blue-600 font-semibold text-blue-800' : 'border-transparent font-medium text-slate-500 hover:text-slate-800'}`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

export function MetricStrip({ items, label }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_2px_8px_rgba(20,30,50,0.035)]" aria-label={label}>
      <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-4 px-5 py-3.5 sm:min-h-[76px] sm:px-6">
            <span className="text-xs font-medium text-slate-600">{item.label}</span>
            <strong className={`text-[23px] font-semibold leading-none tracking-[-.035em] tabular-nums ${item.tone === 'blue' ? 'text-blue-700' : 'text-slate-900'}`}>
              {item.value}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function WorkspacePanel({ title, description, actions, children, className = '' }) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_2px_8px_rgba(20,30,50,0.04)] ${className}`}>
      <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="m-0 text-[15px] font-semibold tracking-[-.01em] text-slate-900">{title}</h2>
          {description && <p className="mb-0 mt-1 text-xs text-slate-500">{description}</p>}
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
