import { useState } from 'react';
import { useAuth } from './AuthProvider.jsx';
import { Button } from '../../core/ui/primitives.jsx';
import { IconShield } from '../../core/icons/Icons.jsx';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <main className="grid min-h-screen bg-white md:grid-cols-[.92fr_1.08fr]">
      <section className="relative flex min-h-[300px] flex-col justify-between overflow-hidden bg-gradient-to-br from-blue-800 via-blue-900 to-blue-950 px-7 py-6 text-white sm:px-10 md:min-h-screen md:px-14 md:py-10 xl:px-20" aria-label="Admissions workspace">
        <span className="pointer-events-none absolute -bottom-40 -right-40 size-[440px] rounded-full border border-white/10 shadow-[0_0_0_44px_rgba(255,255,255,0.03),0_0_0_94px_rgba(255,255,255,0.025)]" />
        <div className="relative z-10 flex items-center gap-3 text-[13px] font-bold">
          <img src="/department-logo.png" alt="Department of Software Engineering" className="size-10 rounded-xl bg-white p-1 object-contain" />
          SE Admissions
        </div>
        <div className="relative z-10 my-8 max-w-xl md:my-auto md:py-12">
          <span className="text-[10px] font-bold tracking-[.15em] text-blue-200">STAFF WORKSPACE</span>
          <h1 className="mb-4 mt-4 text-4xl font-bold leading-[1.06] tracking-tight sm:text-5xl xl:text-6xl">Admissions work,<br />in clear view.</h1>
          <p className="max-w-sm text-xs leading-7 text-blue-100 sm:text-sm">A secure workspace for applicant outreach, document verification, and admissions operations.</p>
          <div className="mt-7 flex items-center gap-2 text-[10px] text-blue-100 sm:text-[11px]"><IconShield className="size-4 text-blue-200" />Protected access for authorized staff</div>
        </div>
        <div className="relative z-10 hidden text-[9px] font-semibold tracking-[.14em] text-blue-200 sm:block">DEPARTMENT OF SOFTWARE ENGINEERING</div>
      </section>

      <section className="grid place-items-center px-6 py-10 sm:px-10 md:px-12 xl:px-20">
        <form className="flex w-full max-w-[410px] flex-col" onSubmit={submit}>
          <span className="text-[10px] font-bold tracking-[.15em] text-blue-700">WELCOME BACK</span>
          <h2 className="mb-2 mt-2.5 text-[26px] font-bold tracking-tight text-blue-950 sm:text-[29px]">Sign in to your account</h2>
          <p className="mb-5 text-xs leading-relaxed text-slate-500">Use the staff credentials provided by your administrator.</p>

          <label htmlFor="email" className="mb-2 mt-3 text-[11px] font-semibold text-slate-700">Work email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />

          <label htmlFor="password" className="mb-2 mt-4 text-[11px] font-semibold text-slate-700">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />

          {error && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] text-rose-800" role="alert">{error}</div>}
          <Button type="submit" disabled={busy} className="mt-6 min-h-11 w-full justify-between px-4 text-xs">
            {busy ? 'Signing in…' : 'Sign in securely'}
            <span aria-hidden="true" className="text-base font-normal">→</span>
          </Button>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[9px] text-slate-400">
            <IconShield className="size-3.5 text-blue-600" />
            <span className="font-semibold text-slate-600">Protected staff access</span>
            <span className="size-1 rounded-full bg-slate-300" />
            Sessions are securely managed
          </div>
        </form>
      </section>
    </main>
  );
}
