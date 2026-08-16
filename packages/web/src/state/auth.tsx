/**
 * Oturum durumu.
 *
 * Zustand yerine düz React context: tek bir kullanıcı nesnesi ve üç eylem için
 * ek bir bağımlılık taşımaya değmiyor.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser } from '@krallik/shared';
import { api, getToken, setToken } from '../api/client';

interface AuthValue {
  user: AuthUser | null;
  /** İlk `GET /auth/me` denemesi sürerken true. */
  bootstrapping: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(getToken() !== null);

  // Sayfa yenilendiğinde localStorage'daki token hâlâ geçerli mi diye bakarız.
  useEffect(() => {
    if (getToken() === null) return;
    let cancelled = false;
    api.auth
      .me()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {
        setToken(null);
      })
      .finally(() => {
        if (!cancelled) setBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.auth.login(email, password);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const res = await api.auth.register(email, password, displayName);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, bootstrapping, login, register, logout }),
    [user, bootstrapping, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı.');
  return ctx;
}
