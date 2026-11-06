import { useState } from 'react';
import { useAuth } from '../modules/auth/AuthProvider.jsx';
import { LoginPage } from '../modules/auth/LoginPage.jsx';
import { UserManagementModal } from '../modules/auth/UserManagementModal.jsx';
import { MarketingModuleView } from '../modules/marketing/MarketingModuleView.jsx';
import { VerificationModuleView } from '../modules/verification/VerificationModuleView.jsx';
import { Button } from '../core/ui/primitives.jsx';
import {
  IconDashboard,
  IconUsers,
  IconDocumentCheck,
  IconLogout,
  IconPlus,
  IconMenu,
  IconShield,
} from '../core/icons/Icons.jsx';

const navigation = [
  { id: 'marketing', label: 'Dashboard', icon: IconDashboard },
  { id: 'verification', label: 'Document verification', icon: IconDocumentCheck },
];

export function App() {
  const { status, user, signOut } = useAuth();
  const [showUserModal, setShowUserModal] = useState(false);
  const [currentNav, setCurrentNav] = useState('marketing');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (status === 'loading') {
    return (
      <main className="grid min-h-screen place-content-center justify-items-center gap-3 bg-slate-50 text-slate-500" aria-live="polite">
        <span className="size-7 animate-spin rounded-full border-2 border-blue-100 border-t-blue-600" />
        <p className="text-sm">Restoring your secure session…</p>
      </main>
    );
  }

  if (!user) return <LoginPage />;

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
        className={`fixed inset-y-0 left-0 z-40 flex w-[256px] flex-col border-r border-slate-200 bg-white px-3 pb-4 transition-transform duration-200 lg:translate-x-0 ${mobileNavOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'}`}
        aria-label="Main navigation"
      >
        <a href="#main-content" className="flex h-[88px] shrink-0 items-center gap-3 border-b border-slate-100 px-3 no-underline">
          <img src="/department-logo.png" alt="Software Engineering department logo" className="size-12 shrink-0 object-contain" />
          <span className="flex min-w-0 flex-col gap-1">
            <strong className="truncate text-sm font-bold tracking-tight text-slate-900">SE Admissions</strong>
            <small className="text-[10px] font-semibold uppercase tracking-[.11em] text-slate-500">Staff workspace</small>
          </span>
        </a>

        <nav className="flex-1 py-7">
          <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[.1em] text-slate-400">Workspace</p>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => selectNavigation(id)}
              className={`relative my-1 flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 text-left text-sm transition ${currentNav === id ? 'bg-blue-50 font-semibold text-blue-800 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r before:bg-blue-600' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
              aria-current={currentNav === id ? 'page' : undefined}
            >
              <Icon className={`size-[18px] shrink-0 ${currentNav === id ? 'text-blue-700' : 'text-slate-400'}`} />
              <span>{label}</span>
            </button>
          ))}

          {isSuperAdmin && (
            <>
              <p className="mb-2 mt-8 px-3 text-[11px] font-bold uppercase tracking-[.1em] text-slate-400">Administration</p>
              <button type="button" onClick={() => setShowUserModal(true)} className="my-1 flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 text-left text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-900">
                <IconUsers className="size-[18px] shrink-0 text-slate-400" />
                <span>Staff management</span>
              </button>
            </>
          )}
        </nav>

        <div className="border-t border-slate-100 px-2 pt-4">
          <div className="flex items-center gap-3 px-1 pb-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700" aria-hidden="true">{initials}</span>
            <span className="flex min-w-0 flex-col gap-1">
              <strong className="truncate text-xs font-semibold text-slate-800" title={user.displayName}>{user.displayName}</strong>
              <small className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{user.role.replaceAll('_', ' ')}</small>
            </span>
          </div>
          <Button variant="subtle" className="w-full" onClick={signOut}>
            <IconLogout className="size-4" />
            Sign out
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-slate-400"><IconShield className="size-3.5 text-blue-600" />Protected workspace</p>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-[256px]">
        <header className="sticky top-0 z-20 flex min-h-[72px] items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" className="grid size-9 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 lg:hidden" aria-label="Open navigation menu" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>
              <IconMenu className="size-[18px]" />
            </button>
            <div className="min-w-0">
              <p className="mb-0 text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Admissions operations</p>
              <p className="mb-0 mt-1 truncate text-sm text-slate-600">Welcome back, <strong className="font-semibold text-slate-900">{user.displayName}</strong></p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2.5 sm:gap-4">
            <span className="hidden items-center gap-2 text-xs font-medium text-slate-600 sm:inline-flex"><span className="size-2 rounded-full bg-blue-600" />Fall 2026</span>
            {isSuperAdmin && (
              <button type="button" onClick={() => setShowUserModal(true)} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-blue-700 px-3 text-xs font-semibold text-white transition hover:bg-blue-800 sm:px-4">
                <IconPlus className="size-4" />
                <span className="hidden sm:inline">Add staff</span>
              </button>
            )}
            <span className="grid size-9 place-items-center rounded-full border border-blue-100 bg-blue-50 text-xs font-bold text-blue-700" title={user.displayName} aria-label={`Signed in as ${user.displayName}`}>{initials}</span>
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-[1520px] px-4 py-6 sm:px-7 sm:py-8 xl:px-9">
          {currentNav === 'marketing' && (
            <div>
              <section className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="mb-1 text-xs font-semibold text-blue-700">Department of Software Engineering</p>
                  <h1 className="m-0 text-[26px] font-bold leading-tight tracking-[-.025em] text-slate-900 sm:text-[30px]">Admissions overview</h1>
                </div>
                <p className="mb-1 text-xs font-medium text-slate-500">Fall 2026 intake</p>
              </section>
              <MarketingModuleView onAddStaff={isSuperAdmin ? () => setShowUserModal(true) : undefined} />
            </div>
          )}

          {currentNav === 'verification' && (
            <div>
              <section className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="mb-1 text-xs font-semibold text-blue-700">Admissions workspace</p>
                  <h1 className="m-0 text-[26px] font-bold leading-tight tracking-[-.025em] text-slate-900 sm:text-[30px]">Document verification</h1>
                </div>
                <p className="mb-1 text-xs font-medium text-slate-500">Intake & Discrepancy Management</p>
              </section>
              <VerificationModuleView />
            </div>
          )}
        </main>
      </div>

      {isSuperAdmin && <UserManagementModal isOpen={showUserModal} onClose={() => setShowUserModal(false)} />}
    </div>
  );
}
