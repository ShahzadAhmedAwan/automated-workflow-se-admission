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
  IconClose,
  IconCheck,
  IconRefresh,
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
  const [showWaModal, setShowWaModal] = useState(false);
  const [waPhoneInput, setWaPhoneInput] = useState('');
  const [savingWaNumber, setSavingWaNumber] = useState(false);
  const [waModalMsg, setWaModalMsg] = useState({ error: '', success: '' });

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

  async function handleSaveWhatsAppNumber(e) {
    e.preventDefault();
    if (!waPhoneInput.trim()) return;
    setSavingWaNumber(true);
    setWaModalMsg({ error: '', success: '' });
    try {
      await marketingApi.updateWhatsAppNumber(waPhoneInput.trim());
      setWaModalMsg({ error: '', success: 'WhatsApp number updated successfully!' });
      const refreshed = await marketingApi.getWhatsAppStatus();
      if (refreshed) setWaStatus(refreshed);
    } catch (err) {
      setWaModalMsg({ error: err.message || 'Failed to update WhatsApp number', success: '' });
    } finally {
      setSavingWaNumber(false);
    }
  }

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
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-7">
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
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-semibold text-slate-900">Department Admissions Portal</span>
              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 border border-blue-100">
                Fall 2026
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {/* WhatsApp Session Status & Phone Config Trigger */}
            <button
              type="button"
              onClick={() => {
                setWaPhoneInput(waStatus.phone || waStatus.adminNumber || '923408195018');
                setWaModalMsg({ error: '', success: '' });
                setShowWaModal(true);
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border cursor-pointer hover:shadow-xs transition ${
                waStatus.connected
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : waStatus.status === 'NEEDS_QR'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}
              title="Click to view or change WhatsApp number & connection"
            >
              <span className={`size-1.5 rounded-full ${waStatus.connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
              <span className="hidden sm:inline">
                {waStatus.connected
                  ? `WhatsApp Online ${waStatus.phone ? `(+${waStatus.phone})` : ''}`
                  : `WhatsApp Offline ${waStatus.phone ? `(+${waStatus.phone})` : ''}`}
              </span>
              <span className="sm:hidden">
                {waStatus.connected ? (waStatus.phone ? `+${waStatus.phone}` : 'Online') : 'Offline'}
              </span>
            </button>

            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => selectNavigation('staff')}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition"
              >
                <IconPlus className="size-3.5" />
                <span>Add staff</span>
              </button>
            )}

            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
              <span className="grid size-8 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700 border border-blue-100" title={user.displayName}>
                {initials}
              </span>
              <span className="hidden sm:block text-xs font-medium text-slate-800">
                {user.displayName}
              </span>
            </div>
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

      {/* WhatsApp Configuration & Number Modal */}
      {showWaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className={`size-2.5 rounded-full ${waStatus.connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                <h3 className="text-base font-bold text-slate-900">WhatsApp Configuration</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowWaModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <IconClose className="size-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Connection Status:</span>
                  <span className={`font-semibold ${waStatus.connected ? 'text-emerald-700' : 'text-slate-600'}`}>
                    {waStatus.connected ? '🟢 Connected (Online)' : waStatus.status === 'NEEDS_QR' ? '🟡 QR Scan Needed' : '⚪ Offline / Standby'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Active Bot Phone:</span>
                  <span className="font-mono font-semibold text-slate-800">
                    +{waStatus.phone || waStatus.adminNumber || 'Not set'}
                  </span>
                </div>
              </div>

              {waModalMsg.error && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  {waModalMsg.error}
                </div>
              )}
              {waModalMsg.success && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                  <IconCheck className="size-4 shrink-0 text-emerald-600" />
                  <span>{waModalMsg.success}</span>
                </div>
              )}

              <form onSubmit={handleSaveWhatsAppNumber} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Change WhatsApp Number
                  </label>
                  <input
                    type="text"
                    value={waPhoneInput}
                    onChange={(e) => setWaPhoneInput(e.target.value)}
                    placeholder="e.g. 923408195018 or 03408195018"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    required
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Enter the WhatsApp phone number (with country code 92 or standard mobile format).
                  </p>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={savingWaNumber || !waPhoneInput.trim()}
                    className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5 transition"
                  >
                    {savingWaNumber ? 'Saving…' : 'Update WhatsApp Number'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowWaModal(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
