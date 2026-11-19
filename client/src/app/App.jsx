import { useState, useEffect } from 'react';
import { useAuth } from '../modules/auth/AuthProvider.jsx';
import { LoginPage } from '../modules/auth/LoginPage.jsx';
import { UserManagementView } from '../modules/auth/UserManagementView.jsx';
import { MarketingModuleView } from '../modules/marketing/MarketingModuleView.jsx';
import { VerificationModuleView } from '../modules/verification/VerificationModuleView.jsx';
import { MeritModuleView } from '../modules/merit/MeritModuleView.jsx';
import { marketingApi } from '../modules/marketing/marketingApi.js';
import { Button } from '../core/ui/primitives.jsx';
import {
  IconDashboard,
  IconUsers,
  IconDocumentCheck,
  IconAcademicCap,
  IconLogout,
  IconPlus,
  IconMenu,
  IconSidebarToggle,
} from '../core/icons/Icons.jsx';

const navigation = [
  {
    id: 'marketing',
    step: '1',
    label: 'Marketing & Leads',
    icon: IconDashboard,
  },
  {
    id: 'verification',
    step: '2',
    label: 'Document Verification',
    icon: IconDocumentCheck,
  },
  {
    id: 'merit',
    step: '3',
    label: 'Merit & Rankings',
    icon: IconAcademicCap,
  },
];

export function App() {
  const { status, user, sessionExpired, signOut } = useAuth();
  const [currentNav, setCurrentNav] = useState('marketing');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [waStatus, setWaStatus] = useState({ connected: false, status: 'CHECKING', phone: null });

  useEffect(() => {
    if (!user) return;
    let mounted = true;

    async function checkWhatsAppStatus() {
      try {
        const data = await marketingApi.getWhatsAppStatus();
        if (mounted && data) setWaStatus(data);
      } catch {
        if (mounted) setWaStatus({ connected: false, status: 'OFFLINE', phone: null });
      }
    }

    checkWhatsAppStatus();
    const interval = setInterval(checkWhatsAppStatus, 20000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [user]);

  if (status === 'loading') {
    return (
      <main className="grid min-h-screen place-content-center justify-items-center gap-3 bg-slate-50 text-slate-500" aria-live="polite">
        <span className="size-7 animate-spin rounded-full border-2 border-blue-100 border-t-blue-600" />
        <p className="text-sm">Restoring your secure session…</p>
      </main>
    );
  }

  if (!user) return <LoginPage sessionExpired={sessionExpired} />;

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const initials = user.displayName.trim().charAt(0).toUpperCase();

  function selectNavigation(id) {
    setCurrentNav(id);
    setMobileNavOpen(false);
  }

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-800">
      <button
        type="button"
        className={`fixed inset-0 z-30 bg-slate-950/40 lg:hidden ${mobileNavOpen ? 'block' : 'hidden'}`}
        aria-label="Close navigation menu"
        onClick={() => setMobileNavOpen(false)}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white pb-4 transition-all duration-200 ${sidebarCollapsed ? 'w-[256px] px-3 lg:w-[72px] lg:px-2' : 'w-[256px] px-3'} lg:translate-x-0 ${mobileNavOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'}`}
        aria-label="Main navigation"
      >
        <div className={`flex h-16 shrink-0 items-center border-b border-slate-100 ${sidebarCollapsed ? 'justify-center px-2' : 'gap-2.5 px-4'}`}>
          <a href="#main-content" className={`flex min-w-0 items-center gap-2.5 no-underline ${sidebarCollapsed ? 'lg:gap-0' : ''}`}>
            <img src="/department-logo.png" alt="Software Engineering department logo" className="size-9 shrink-0 object-contain" />
            <span className={`${sidebarCollapsed ? 'lg:hidden' : ''} flex min-w-0 flex-col`}>
              <strong className="truncate text-xs font-bold tracking-tight text-slate-900">SE Admissions</strong>
              <small className="text-[10px] text-slate-500">Department Portal</small>
            </span>
          </a>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <p className={`${sidebarCollapsed ? 'lg:hidden' : ''} mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400`}>Admissions Workflow</p>
          {navigation.map(({ id, step, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => selectNavigation(id)}
              title={sidebarCollapsed ? `${step}. ${label}` : undefined}
              aria-label={label}
              className={`relative flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition cursor-pointer text-xs ${
                sidebarCollapsed ? 'lg:justify-center lg:gap-0 lg:px-0' : ''
              } ${
                currentNav === id
                  ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200/80 shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium border border-transparent'
              }`}
              aria-current={currentNav === id ? 'page' : undefined}
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold transition-colors ${
                  currentNav === id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {step}
              </span>
              <span className={`${sidebarCollapsed ? 'lg:hidden' : ''} truncate text-xs font-medium`}>
                {label}
              </span>
            </button>
          ))}

          {isSuperAdmin && (
            <>
              <p className={`${sidebarCollapsed ? 'lg:hidden' : ''} mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400`}>Administration</p>
              <button
                type="button"
                title={sidebarCollapsed ? 'Staff Management' : undefined}
                aria-label="Staff Management"
                onClick={() => selectNavigation('staff')}
                className={`relative flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition cursor-pointer text-xs ${
                  sidebarCollapsed ? 'lg:justify-center lg:gap-0 lg:px-0' : ''
                } ${
                  currentNav === 'staff'
                    ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200/80 shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium border border-transparent'
                }`}
                aria-current={currentNav === 'staff' ? 'page' : undefined}
              >
                <div
                  className={`flex size-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold transition-colors ${
                    currentNav === 'staff' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <IconUsers className="size-3" />
                </div>
                <span className={`${sidebarCollapsed ? 'lg:hidden' : ''} truncate text-xs font-medium`}>
                  Staff Management
                </span>
              </button>
            </>
          )}
        </nav>

        <div className={`border-t border-slate-100 pt-4 ${sidebarCollapsed ? 'px-1 lg:px-0' : 'px-2'}`}>
          <div className={`flex items-center pb-3 ${sidebarCollapsed ? 'justify-center' : 'gap-3 px-1'}`}>
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700" aria-hidden="true">{initials}</span>
            <span className={`${sidebarCollapsed ? 'lg:hidden' : ''} flex min-w-0 flex-col gap-1`}>
              <strong className="truncate text-xs font-semibold text-slate-800" title={user.displayName}>{user.displayName}</strong>
              <small className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{user.role.replaceAll('_', ' ')}</small>
            </span>
          </div>
          <div className={`mt-3 ${sidebarCollapsed ? 'lg:flex lg:flex-col lg:items-center lg:gap-3' : 'space-y-3'}`}>
            <Button variant="subtle" className={`w-full ${sidebarCollapsed ? 'lg:size-10 lg:min-h-10 lg:gap-0 lg:justify-center lg:p-0' : ''}`} title={sidebarCollapsed ? 'Sign out' : undefined} aria-label="Sign out" onClick={signOut}>
              <IconLogout className="size-[18px]" />
              <span className={sidebarCollapsed ? 'lg:hidden' : ''}>Sign out</span>
            </Button>
            <button type="button" className={`hidden min-h-10 items-center rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 lg:flex ${sidebarCollapsed ? 'lg:size-10 lg:min-h-10 lg:justify-center lg:p-0' : 'w-full justify-between px-3'}`} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>
              <span className={sidebarCollapsed ? 'lg:hidden' : ''}>Collapse sidebar</span>
              <IconSidebarToggle className="size-[18px]" collapsed={sidebarCollapsed} />
            </button>
          </div>
        </div>
      </aside>

      <div className={`min-h-screen transition-[padding] duration-200 ${sidebarCollapsed ? 'lg:pl-[72px]' : 'lg:pl-[256px]'}`}>
        <header className="sticky top-0 z-20 flex min-h-[72px] items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 lg:hidden cursor-pointer"
              aria-label="Open navigation menu"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              <IconMenu className="size-[18px]" />
            </button>
            <div className="min-w-0">
              <p className="mb-0 truncate text-xs text-slate-600">
                Department Admissions Portal · Signed in as <strong className="font-semibold text-slate-900">{user.displayName}</strong>
              </p>
            </div>
          </div>

          {/* Institutional Workflow Stepper: One-Click Quick Navigation */}
          <div className="hidden xl:flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 p-1 text-xs shadow-2xs">
            {navigation.map(({ id, step, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => selectNavigation(id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold transition cursor-pointer ${
                  currentNav === id
                    ? 'bg-white text-blue-800 shadow-xs border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                <span className={`inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold ${
                  currentNav === id ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {step}
                </span>
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-2.5 sm:gap-4">
            {/* WhatsApp Session Health Badge */}
            {waStatus.connected ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 shadow-xs"
                title={`WhatsApp Connected (+${waStatus.phone || 'Bot'}). Outreach worker is active.`}
              >
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="hidden md:inline">WhatsApp Online</span>
                <span className="md:hidden">Online</span>
              </span>
            ) : waStatus.status === 'NEEDS_QR' ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 shadow-xs"
                title="WhatsApp requires QR scan. Run 'npm run start:whatsapp' and scan QR."
              >
                <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="hidden sm:inline">WhatsApp: Scan QR</span>
                <span className="sm:hidden">Scan QR</span>
              </span>
            ) : waStatus.status === 'RECONNECTING' ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-800 shadow-xs"
                title="WhatsApp client is reconnecting..."
              >
                <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="hidden sm:inline">WhatsApp Reconnecting</span>
                <span className="sm:hidden">Reconnecting</span>
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-800 shadow-xs"
                title="WhatsApp bot process is offline. Run 'npm run start:whatsapp' to start the outreach bot."
              >
                <span className="size-2 rounded-full bg-rose-500" />
                <span className="hidden md:inline">WhatsApp Offline</span>
                <span className="md:hidden">Offline</span>
              </span>
            )}

            <span className="hidden items-center gap-2 text-xs font-medium text-slate-600 sm:inline-flex"><span className="size-2 rounded-full bg-blue-600" />Fall 2026</span>
            {isSuperAdmin && (
              <button type="button" onClick={() => selectNavigation('staff')} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-blue-700 px-3 text-xs font-semibold text-white transition hover:bg-blue-800 sm:px-4">
                <IconPlus className="size-4" />
                <span className="hidden sm:inline">Add staff</span>
              </button>
            )}
            <span className="grid size-9 place-items-center rounded-full border border-blue-100 bg-blue-50 text-xs font-bold text-blue-700" title={user.displayName} aria-label={`Signed in as ${user.displayName}`}>{initials}</span>
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-[1520px] px-4 py-5 sm:px-7 sm:py-6 xl:px-9">
          {currentNav === 'marketing' && (
            <div>
              <div className="mb-5 flex items-center justify-between border-b border-slate-200/80 pb-3.5">
                <h1 className="m-0 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  Marketing & Leads
                </h1>
              </div>
              <MarketingModuleView />
            </div>
          )}

          {currentNav === 'verification' && (
            <div>
              <div className="mb-5 flex items-center justify-between border-b border-slate-200/80 pb-3.5">
                <h1 className="m-0 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  Document Verification
                </h1>
              </div>
              <VerificationModuleView />
            </div>
          )}

          {currentNav === 'merit' && (
            <div>
              <div className="mb-5 flex items-center justify-between border-b border-slate-200/80 pb-3.5">
                <h1 className="m-0 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  Merit & Rankings
                </h1>
              </div>
              <MeritModuleView />
            </div>
          )}

          {currentNav === 'staff' && isSuperAdmin && (
            <div>
              <div className="mb-5 flex items-center justify-between border-b border-slate-200/80 pb-3.5">
                <h1 className="m-0 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  Staff Management
                </h1>
              </div>
              <UserManagementView />
            </div>
          )}
        </main>
      </div>

    </div>
  );
}
