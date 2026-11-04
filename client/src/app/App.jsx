import { useAuth } from '../modules/auth/AuthProvider.jsx';
import { LoginPage } from '../modules/auth/LoginPage.jsx';

export function App() {
  const { status, user, signOut } = useAuth();
  if (status === 'loading') {
    return <main className="page-shell"><p className="muted">Restoring your secure session…</p></main>;
  }
  if (!user) return <LoginPage />;
  return (
    <main className="page-shell">
      <header className="topbar">
        <div><span className="eyebrow">SE ADMISSIONS</span><h1>Operations workspace</h1></div>
        <button className="button button-quiet" onClick={signOut}>Sign out</button>
      </header>
      <section className="welcome-card">
        <span className="status-dot" />
        <div><p className="eyebrow">SIGNED IN AS {user.role.replaceAll('_', ' ')}</p><h2>Welcome, {user.displayName}</h2><p className="muted">Your account is ready. Module workspaces will appear here as they are integrated.</p></div>
      </section>
    </main>
  );
}
