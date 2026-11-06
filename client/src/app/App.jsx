import { useState } from 'react';
import { useAuth } from '../modules/auth/AuthProvider.jsx';
import { LoginPage } from '../modules/auth/LoginPage.jsx';
import { UserManagementView } from '../modules/auth/UserManagementView.jsx';
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
  IconSidebarToggle,
} from '../core/icons/Icons.jsx';

const navigation = [
  { id: 'marketing', label: 'Dashboard', icon: IconDashboard },
  { id: 'verification', label: 'Document verification', icon: IconDocumentCheck },
];

export function App() {
  const { status, user, sessionExpired, signOut } = useAuth();
  const [currentNav, setCurrentNav] = useState('marketing');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

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
        <div className={`flex h-[88px] shrink-0 items-center border-b border-slate-100 ${sidebarCollapsed ? 'justify-center px-2' : 'gap-2 px-3'}`}>
          <a href="#main-content" className={`flex min-w-0 items-center gap-3 no-underline ${sidebarCollapsed ? 'lg:gap-0' : ''}`}>
            <img src="/department-logo.png" alt="Software Engineering department logo" className="size-12 shrink-0 object-contain" />
            <span className={`${sidebarCollapsed ? 'lg:hidden' : ''} flex min-w-0 flex-col gap-1`}>
              <strong className="truncate text-sm font-bold tracking-tight text-slate-900">SE Admissions</strong>
              <small className="text-[10px] font-semibold uppercase tracking-[.11em] text-slate-500">Staff workspace</small>
            </span>
          </a>
        </div>

        <nav className="flex-1 py-6">
          <p className={`${sidebarCollapsed ? 'lg:hidden' : ''} mb-2 px-3 text-[11px] font-bold uppercase tracking-[.1em] text-slate-400`}>Workspace</p>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => selectNavigation(id)}
              title={sidebarCollapsed ? label : undefined}
              aria-label={label}
              className={`relative my-1 flex min-h-[44px] w-full items-center rounded-md text-left text-sm transition gap-3 px-3 ${sidebarCollapsed ? 'lg:justify-center lg:gap-0 lg:px-0' : ''} ${currentNav === id ? 'bg-blue-50 font-semibold text-blue-800 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r before:bg-blue-600' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
              aria-current={currentNav === id ? 'page' : undefined}
            >
              <Icon className={`size-[18px] shrink-0 ${currentNav === id ? 'text-blue-700' : 'text-slate-400'}`} />
              <span className={sidebarCollapsed ? 'lg:hidden' : ''}>{label}</span>
            </button>
          ))}

          {isSuperAdmin && (
            <>
              <p className={`${sidebarCollapsed ? 'lg:hidden' : ''} mb-2 mt-8 px-3 text-[11px] font-bold uppercase tracking-[.1em] text-slate-400`}>Administration</p>
              <button type="button" title={sidebarCollapsed ? 'Staff management' : undefined} aria-label="Staff management" onClick={() => selectNavigation('staff')} className={`relative my-1 flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 text-left text-sm transition ${sidebarCollapsed ? 'lg:justify-center lg:gap-0 lg:px-0' : ''} ${currentNav === 'staff' ? 'bg-blue-50 font-semibold text-blue-800 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r before:bg-blue-600' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`} aria-current={currentNav === 'staff' ? 'page' : undefined}>
                <IconUsers className="size-[18px] shrink-0 text-slate-400" />
                <span className={sidebarCollapsed ? 'lg:hidden' : ''}>Staff management</span>
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
              <button type="button" onClick={() => selectNavigation('staff')} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-blue-700 px-3 text-xs font-semibold text-white transition hover:bg-blue-800 sm:px-4">
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
              </section>
              <MarketingModuleView />
            </div>
          )}

          {currentNav === 'verification' && (
            <div>
              <section className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="mb-1 text-xs font-semibold text-blue-700">Admissions workspace</p>
                  <h1 className="m-0 text-[26px] font-bold leading-tight tracking-[-.025em] text-slate-900 sm:text-[30px]">Document verification</h1>
                </div>
                <p className="mb-1 text-xs font-medium text-slate-500">Review applicant documents</p>
              </section>
              <VerificationModuleView />
            </div>
          )}

          {currentNav === 'staff' && isSuperAdmin && (
            <div>
              <section className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="mb-1 text-xs font-semibold text-blue-700">Administration</p>
                  <h1 className="m-0 text-[26px] font-bold leading-tight tracking-[-.025em] text-slate-900 sm:text-[30px]">Staff management</h1>
                </div>
                <p className="mb-1 text-xs font-medium text-slate-500">Manage workspace access</p>
              </section>
              <UserManagementView />
            </div>
          )}
        </main>
      </div>

    </div>
  );
}
