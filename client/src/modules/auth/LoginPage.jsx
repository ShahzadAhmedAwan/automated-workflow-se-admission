import { useState } from 'react';
import { useAuth } from './AuthProvider.jsx';

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
    <main className="login-layout">
      <section className="login-brand">
        <div className="brand-mark">SE</div>
        <span className="eyebrow">ADMISSIONS AUTOMATION</span>
        <h1>Clear workflows.<br />Confident decisions.</h1>
        <p>One secure workspace for applicant intake, verification, and merit operations.</p>
        <div className="brand-footer">STAFF ACCESS · PROTECTED WORKSPACE</div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <span className="eyebrow">WELCOME BACK</span>
          <h2>Sign in to your account</h2>
          <p className="muted">Use the staff credentials provided by your administrator.</p>
          <label htmlFor="email">Work email</label>
          <input id="email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'} <span aria-hidden="true">→</span></button>
          <div className="secure-note"><span aria-hidden="true">▣</span> Protected staff access · Sessions are securely managed</div>
        </form>
      </section>
    </main>
  );
}
