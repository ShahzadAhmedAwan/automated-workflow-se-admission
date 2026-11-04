import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from './authApi.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  const restore = useCallback(async () => {
    const restoredUser = await authApi.restore();
    setUser(restoredUser);
    setStatus('ready');
  }, []);

  useEffect(() => { void restore(); }, [restore]);

  useEffect(() => {
    if (!user) return undefined;
    const timer = window.setTimeout(async () => {
      const refreshedUser = await authApi.refresh();
      if (!refreshedUser) { setUser(null); return; }
      setUser(refreshedUser);
    }, authApi.refreshDelay());
    return () => window.clearTimeout(timer);
  }, [user]);

  const signIn = useCallback(async (email, password) => {
    const signedIn = await authApi.login(email, password);
    setUser(signedIn);
  }, []);

  const signOut = useCallback(async () => {
    try { await authApi.logout(); } catch { /* Clear the local session even if the API is unavailable. */ }
    finally { setUser(null); }
  }, []);

  const value = useMemo(() => ({ user, status, signIn, signOut }), [user, status, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
