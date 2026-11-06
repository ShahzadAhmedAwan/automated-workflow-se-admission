import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from './authApi.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  const [sessionExpired, setSessionExpired] = useState(false);

  const restore = useCallback(async () => {
    let restoredUser = null;
    try { restoredUser = await authApi.restore(); } catch { /* Show sign-in if the session cannot be restored. */ }
    setUser(restoredUser);
    setStatus('ready');
  }, []);

  useEffect(() => { void restore(); }, [restore]);

  useEffect(() => {
    const handleSessionExpired = () => {
      setSessionExpired(true);
      setUser(null);
    };
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth:session-expired', handleSessionExpired);
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        const refreshedUser = await authApi.refresh();
        if (!refreshedUser) {
          setSessionExpired(true);
          setUser(null);
          return;
        }
        setUser(refreshedUser);
      } catch {
        // Keep the workspace open during a brief network outage; protected requests can retry refresh.
      }
    }, authApi.refreshDelay());
    return () => window.clearTimeout(timer);
  }, [user]);

  const signIn = useCallback(async (email, password) => {
    const signedIn = await authApi.login(email, password);
    setSessionExpired(false);
    setUser(signedIn);
  }, []);

  const signOut = useCallback(async () => {
    try { await authApi.logout(); } catch { /* Clear the local session even if the API is unavailable. */ }
    finally { setSessionExpired(false); setUser(null); }
  }, []);

  const value = useMemo(() => ({ user, status, sessionExpired, signIn, signOut }), [user, status, sessionExpired, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
