import { useState, useEffect } from 'react';
import { userManagementApi } from './userManagementApi.js';
import { IconPlus, IconRefresh, IconCheck } from '../../core/icons/Icons.jsx';
import { Button } from '../../core/ui/primitives.jsx';

// Four system roles defined in Module 1 implementation plan
const SYSTEM_ROLES = [
  {
    name: 'SUPER_ADMIN',
    label: 'Super Admin',
    badge: 'bg-purple-50 text-purple-700 border-purple-200',
    description: 'Full access, including staff accounts.',
  },
  {
    name: 'ADMISSION_OFFICER',
    label: 'Admission Officer',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    description: 'Manages campaigns and admissions settings.',
  },
  {
    name: 'VERIFIER',
    label: 'Document Verifier',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    description: 'Reviews applicant documents and marks.',
  },
  {
    name: 'AUDITOR',
    label: 'Auditor',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
    description: 'Can view records and reports but cannot make changes.',
  },
];

export function UserManagementView() {
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
    loadData();
  }, []);

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
          return apiMatch ? { ...sr, description: sr.description } : sr;
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

      setSuccess(`Staff account created for ${displayName}.`);
      setEmail('');
      setDisplayName('');
      setPassword('');
      await loadData();
    } catch (err) {
      setError(err.message || 'Could not create staff account.');
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

  const currentRoleInfo = roles.find((r) => r.name === selectedRole) || roles[0];

  return (
    <div className="space-y-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
              <IconCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Form: Provision New User */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(20,30,50,0.035)] sm:p-6">
            <div className="mb-5 flex items-start gap-3 border-b border-slate-100 pb-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-700"><IconPlus className="size-[18px]" /></span>
              <div>
                <h2 className="m-0 text-sm font-semibold text-slate-900">Add a staff member</h2>
                <p className="mb-0 mt-1 text-xs text-slate-500">Create a workspace account and assign its access level.</p>
              </div>
            </div>
            <form onSubmit={handleCreateUser} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Name</label>
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
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Work email</label>
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
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Temporary password</label>
                <input
                  type="password"
                  required
                  placeholder="Create a temporary password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Use 12+ characters with an uppercase letter, lowercase letter, and number.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Role</label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none font-medium"
                >
                  {roles.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Role Scope Description Callout */}
              <div className="md:col-span-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-start gap-2.5">
                <span className="font-bold text-slate-800 shrink-0">Access:</span>
                <span>{currentRoleInfo?.description}</span>
              </div>

              <div className="md:col-span-2 flex justify-end pt-1">
                <Button
                  type="submit"
                  disabled={submitting}
                  className="min-h-10 px-5"
                >
                  <IconPlus className="size-4" />
                  {submitting ? 'Creating…' : 'Create staff account'}
                </Button>
              </div>
            </form>
          </section>

          {/* User Directory Table */}
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_2px_8px_rgba(20,30,50,0.035)]">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
              <h2 className="m-0 text-sm font-semibold text-slate-900">
                Staff Members ({users.length})
              </h2>
              <button
                type="button"
                onClick={loadData}
                disabled={loading}
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
              >
                <IconRefresh className="size-4" /> Refresh
              </button>
            </div>

            {loading ? (
              <div className="p-10 text-center text-sm text-slate-500">Loading staff…</div>
            ) : users.length === 0 ? (
              <div className="grid min-h-36 place-content-center justify-items-center px-5 text-center">
                <p className="mb-0 text-sm font-medium text-slate-700">No staff accounts found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="border-b border-slate-100 bg-[#f4f7fb] text-[11px] font-semibold uppercase tracking-[.055em] text-slate-600">
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
                        <tr key={u.id} className="transition hover:bg-slate-50/70">
                          <td className="px-5 py-3.5">
                            <div className="font-semibold text-slate-900">{u.displayName}</div>
                            <div className="text-xs text-slate-500">{u.email}</div>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold border ${roleMeta?.badge || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                              {roleMeta?.label || u.role.replaceAll('_', ' ')}
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
          </section>
    </div>
  );
}
