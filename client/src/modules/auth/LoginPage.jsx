import { useState } from 'react';
import { useAuth } from './AuthProvider.jsx';
import { Button } from '../../core/ui/primitives.jsx';
import { IconEye, IconEyeOff, IconShield } from '../../core/icons/Icons.jsx';

export function LoginPage({ sessionExpired = false }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try { await signIn(email, password); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="relative isolate grid min-h-screen place-items-center overflow-hidden bg-[#dceafa] px-4 py-6 sm:px-6 sm:py-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-[0.82]"
        style={{ backgroundImage: "url('https://images.unsplash.com/photo-1592930954854-7d00c87d0cf4?auto=format&fit=crop&w=1600&q=45')" }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-blue-950/50" />
      <section className="relative w-full max-w-[440px] rounded-2xl border border-white/80 bg-white px-6 py-7 shadow-[0_24px_80px_rgba(20,48,82,0.24)] sm:rounded-[22px] sm:px-9 sm:py-8" aria-label="Staff sign in">
        <header className="mb-6 flex flex-col items-center text-center">
          <img src="/department-logo.png" alt="Department of Software Engineering logo" className="mb-2 size-12 object-contain" />
          <p className="mb-0 text-sm font-bold tracking-tight text-slate-900">SE Admissions</p>
          <p className="mb-0 mt-1 text-[10px] font-semibold uppercase tracking-[.13em] text-blue-700">Staff workspace</p>
        </header>

        <div className="mb-7 text-center">
          <h1 className="mb-0 text-[24px] font-bold leading-tight tracking-[-.03em] text-slate-900 sm:text-[26px]">Welcome back</h1>
          <p className="mb-0 mt-1.5 text-[13px] leading-5 text-slate-500">Sign in to continue to the admissions workspace.</p>
        </div>

        {sessionExpired && (
          <p className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-3.5 py-3 text-[13px] leading-5 text-blue-900" role="status">
            Your session expired. Sign in again to continue.
          </p>
        )}

        <form className="flex flex-col" onSubmit={submit}>
          <label htmlFor="email" className="mb-1.5 text-xs font-semibold text-slate-700">Work email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter your work email"
            className="h-11 rounded-lg border border-slate-200 bg-[#f7faff] px-3.5 text-[13px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
          />

          <label htmlFor="password" className="mb-1.5 mt-4 text-xs font-semibold text-slate-700">Password</label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              className="h-11 w-full rounded-lg border border-slate-200 bg-[#f7faff] px-3.5 pr-12 text-[13px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              aria-controls="password"
              className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-slate-500 transition hover:text-blue-700 focus-visible:outline-blue-600"
            >
              {showPassword ? <IconEyeOff className="size-[18px]" /> : <IconEye className="size-[18px]" />}
            </button>
          </div>

          {error && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-[13px] leading-5 text-rose-800" role="alert">{error}</div>}
          <Button type="submit" disabled={busy} className="mt-5 min-h-11 w-full rounded-lg px-4 text-[13px] font-semibold">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-center gap-2 border-t border-slate-100 pt-4 text-[11px] text-slate-500">
          <IconShield className="size-4 shrink-0 text-blue-600" />
          <span>Protected access for authorized staff</span>
        </div>
      </section>
    </main>
  );
}
