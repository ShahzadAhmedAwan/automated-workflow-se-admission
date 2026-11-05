import { useState } from 'react';
import { useAuth } from '../modules/auth/AuthProvider.jsx';
import { LoginPage } from '../modules/auth/LoginPage.jsx';
import { UserManagementModal } from '../modules/auth/UserManagementModal.jsx';
import { MarketingModuleView } from '../modules/marketing/MarketingModuleView.jsx';
import {
  IconDashboard,
  IconUsers,
  IconMegaphone,
  IconDocumentCheck,
  IconLogout,
  IconSearch,
  IconPlus,
} from '../core/icons/Icons.jsx';

export function App() {
  const { status, user, signOut } = useAuth();
  const [showUserModal, setShowUserModal] = useState(false);
  const [currentNav, setCurrentNav] = useState('marketing'); // 'dashboard' | 'marketing' | 'verification'

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center text-slate-500 gap-3">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium">Restoring secure session…</p>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-row font-sans">
      
      {/* ======================= LEFT SIDEBAR ======================= */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
        {/* Brand / Logo Header */}
        <div className="h-20 px-6 border-b border-slate-200 flex items-center gap-3.5">
          <img
            src="/department-logo.png"
            alt="Department of Software Engineering Logo"
            className="w-12 h-12 object-contain"
          />
          <div>
            <div className="font-extrabold text-sm text-slate-900 leading-tight">
              Software Engineering
            </div>
            <div className="text-[11px] font-semibold text-blue-700 tracking-wide uppercase">
              Admissions Portal
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-6 space-y-1.5">
          <div className="px-3 pb-2 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
            Navigation Menu
          </div>

          <button
            onClick={() => setCurrentNav('marketing')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition cursor-pointer ${
              currentNav === 'marketing'
                ? 'bg-blue-50 text-blue-700 font-bold'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <IconMegaphone className={`w-5 h-5 ${currentNav === 'marketing' ? 'text-blue-700' : 'text-slate-400'}`} />
            <span>Marketing & Outreach</span>
          </button>

          <button
            onClick={() => setCurrentNav('verification')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition cursor-pointer ${
              currentNav === 'verification'
                ? 'bg-blue-50 text-blue-700 font-bold'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <IconDocumentCheck className={`w-5 h-5 ${currentNav === 'verification' ? 'text-blue-700' : 'text-slate-400'}`} />
            <span>Document Verification</span>
            <span className="ml-auto text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
              Module 3
            </span>
          </button>

          {isSuperAdmin && (
            <button
              onClick={() => setShowUserModal(true)}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition cursor-pointer"
            >
              <IconUsers className="w-5 h-5 text-slate-400" />
              <span>Staff Management</span>
            </button>
          )}
        </nav>

        {/* User Footer Card */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center font-bold text-xs text-blue-700">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="overflow-hidden">
                <div className="text-xs font-bold text-slate-900 truncate">{user.displayName}</div>
                <div className="text-[10px] text-slate-500 font-mono truncate">{user.role.replaceAll('_', ' ')}</div>
              </div>
            </div>
          </div>

          <button
            onClick={signOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 transition cursor-pointer"
          >
            <IconLogout className="w-4 h-4 text-slate-500" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* ======================= MAIN CONTENT WRAPPER ======================= */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top Navbar */}
        <header className="h-20 bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0">
          {/* Search Bar / Context */}
          <div className="flex items-center gap-3 w-80">
            <div className="relative w-full">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <IconSearch className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="Search candidates, leads, campaigns..."
                className="w-full pl-9 pr-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:border-blue-600 focus:outline-none transition"
              />
            </div>
          </div>

          {/* Top Right Academic Status & Actions */}
          <div className="flex items-center gap-4">
            <div className="text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
              Academic Session: <strong className="text-slate-800">Fall 2026</strong>
            </div>

            {isSuperAdmin && (
              <button
                onClick={() => setShowUserModal(true)}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <IconPlus className="w-4 h-4" />
                <span>Add User</span>
              </button>
            )}
          </div>
        </header>

        {/* Dashboard Canvas */}
        <main className="flex-1 p-8 overflow-y-auto">
          {currentNav === 'marketing' && (
            <div className="max-w-7xl mx-auto space-y-6">
              {/* Header Title Banner */}
              <div className="bg-gradient-to-r from-blue-900 via-slate-900 to-indigo-950 rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
                <div className="relative z-10">
                  <div className="text-xs font-semibold uppercase tracking-wider text-blue-300 mb-1">
                    Department of Software Engineering Admissions
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight">
                    Welcome back, {user.displayName}
                  </h1>
                  <p className="text-xs text-slate-300 mt-1.5 max-w-2xl">
                    Admissions intake and lead qualification pipeline. Manage anti-ban WhatsApp outreach campaigns, verify candidate marks, and monitor admissions eligibility in real-time.
                  </p>
                </div>
              </div>

              {/* Module 2 Marketing View */}
              <MarketingModuleView />
            </div>
          )}

          {currentNav === 'verification' && (
            <div className="max-w-7xl mx-auto bg-white border border-slate-200 rounded-xl p-8 shadow-xs text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
                <IconDocumentCheck className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Module 3: Document Verification & AI OCR</h2>
              <p className="text-xs text-slate-500 max-w-lg mx-auto">
                This module handles single-use token issuance, dynamic applicant upload dropzones, Gemini Flash marksheet OCR, and BISE portal verification.
              </p>
            </div>
          )}
        </main>
      </div>

      {/* Super Admin User Management Modal */}
      {isSuperAdmin && (
        <UserManagementModal
          isOpen={showUserModal}
          onClose={() => setShowUserModal(false)}
        />
      )}
    </div>
  );
}
