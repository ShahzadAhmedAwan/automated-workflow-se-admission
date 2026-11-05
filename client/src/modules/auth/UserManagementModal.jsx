import { useState, useEffect } from 'react';
import { userManagementApi } from './userManagementApi.js';
import { IconClose, IconPlus, IconRefresh, IconCheck } from '../../core/icons/Icons.jsx';

// Four system roles defined in Module 1 implementation plan
const SYSTEM_ROLES = [
  {
    name: 'SUPER_ADMIN',
    label: 'Super Admin',
    badge: 'bg-purple-50 text-purple-700 border-purple-200',
    description: 'Full system access, staff management, and locked merit snapshot control.',
  },
  {
    name: 'ADMISSION_OFFICER',
    label: 'Admission Officer',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    description: 'Manages marketing outreach campaigns, intake policies, and merit calculations.',
  },
  {
    name: 'VERIFIER',
    label: 'Document Verifier',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    description: 'Reviews candidate marksheet documents, OCR extractions, and reissues intake tokens.',
  },
  {
    name: 'AUDITOR',
    label: 'Auditor',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
    description: 'Read-only access to immutable audit history, merit lists, and candidate files.',
  },
];

export function UserManagementModal({ isOpen, onClose }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState(SYSTEM_ROLES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState('ADMISSION_OFFICER');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [uList, rList] = await Promise.all([
        userManagementApi.listUsers(),
        userManagementApi.listRoles(),
      ]);
      setUsers(uList || []);
      if (rList?.length) {
        // Merge descriptions with our defined roles
        const merged = SYSTEM_ROLES.map((sr) => {
          const apiMatch = rList.find((r) => r.name === sr.name);
          return apiMatch ? { ...sr, description: apiMatch.description || sr.description } : sr;
        });
        setRoles(merged);
      }
    } catch (err) {
      setError(err.message || 'Could not load staff users.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);

    try {
      await userManagementApi.createUser({
        email: email.trim(),
        displayName: displayName.trim(),
        password,
        role: selectedRole,
      });

      setSuccess(`Account provisioned successfully for ${displayName} as ${selectedRole.replaceAll('_', ' ')}. Welcome email dispatched.`);
      setEmail('');
      setDisplayName('');
      setPassword('');
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to provision staff account.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(user) {
    try {
      await userManagementApi.updateUser(user.id, {
        isActive: !user.isActive,
      });
      loadData();
    } catch (err) {
      setError(err.message || 'Could not update user status.');
    }
  }

  if (!isOpen) return null;

  const currentRoleInfo = roles.find((r) => r.name === selectedRole) || roles[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 bg-slate-50/75">
          <div>
            <span className="text-xs font-semibold tracking-wider text-blue-700 uppercase">Super Admin Access</span>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">Staff & Role-Based Access Control (RBAC)</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-200 transition cursor-pointer"
          >
            <IconClose className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto bg-slate-50/30">
          {error && (
            <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
              <IconCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Form: Provision New User */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
              <IconPlus className="w-4 h-4 text-blue-600" /> Provision New Staff Account
            </h3>
            <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Staff Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Tariq Mahmood"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Official Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="tariq.mahmood@admissions.domain"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Temporary Password</label>
                <input
                  type="password"
                  required
                  placeholder="Min 12 chars, 1 uppercase, 1 lowercase, 1 digit"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Password policy: Minimum 12 characters, including at least one uppercase, one lowercase, and one number.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Assigned System Role</label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none font-medium"
                >
                  {roles.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name.replaceAll('_', ' ')} — {r.name === 'SUPER_ADMIN' ? 'Full System Authority' : r.name === 'ADMISSION_OFFICER' ? 'Campaigns & Policies' : r.name === 'VERIFIER' ? 'Document Verification' : 'Read-Only Audit'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Role Scope Description Callout */}
              <div className="md:col-span-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-start gap-2.5">
                <span className="font-bold text-slate-800 shrink-0">Role Permissions:</span>
                <span>{currentRoleInfo?.description}</span>
              </div>

              <div className="md:col-span-2 flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  <IconPlus className="w-4 h-4" />
                  <span>{submitting ? 'Provisioning...' : 'Provision Staff Member'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* User Directory Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Staff Members ({users.length})
              </h3>
              <button
                onClick={loadData}
                className="text-xs text-slate-600 hover:text-blue-600 flex items-center gap-1.5 transition font-medium cursor-pointer"
              >
                <IconRefresh className="w-3.5 h-3.5" /> Reload Directory
              </button>
            </div>

            {loading ? (
              <div className="p-8 text-center text-slate-500 text-sm">Loading staff directory...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3">Staff Member</th>
                      <th className="px-5 py-3">Assigned Role</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((u) => {
                      const roleMeta = roles.find((r) => r.name === u.role);
                      return (
                        <tr key={u.id} className="hover:bg-slate-50/75 transition">
                          <td className="px-5 py-3.5">
                            <div className="font-semibold text-slate-900">{u.displayName}</div>
                            <div className="text-xs text-slate-500">{u.email}</div>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold border ${roleMeta?.badge || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                              {u.role.replaceAll('_', ' ')}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${u.isActive ? 'text-emerald-700' : 'text-slate-400'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${u.isActive ? 'bg-emerald-600' : 'bg-slate-400'}`} />
                              {u.isActive ? 'Active' : 'Deactivated'}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              onClick={() => handleToggleActive(u)}
                              className="text-xs text-slate-600 hover:text-slate-900 px-3 py-1 rounded border border-slate-200 hover:bg-slate-100 transition cursor-pointer"
                            >
                              {u.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-sm font-medium transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
