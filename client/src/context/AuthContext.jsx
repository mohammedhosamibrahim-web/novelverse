import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      await api('/auth/csrf'); // ensure the CSRF cookie exists for future mutations
      const { user: me } = await api('/auth/me');
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const { user: me } = await api('/auth/login', { method: 'POST', body: { email, password } });
    setUser(me);
    return me;
  }, []);

  const register = useCallback(async (username, email, password) => {
    const { user: me, isFirstAccount } = await api('/auth/register', {
      method: 'POST',
      body: { username, email, password },
    });
    setUser(me);
    return { user: me, isFirstAccount };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
