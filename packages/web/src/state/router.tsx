/**
 * Küçük hash-router.
 *
 * Tam bir router kütüphanesi eklemek yerine (bağımlılıkları hafif tutma kararı)
 * `#/oyun/<id>` biçiminde birkaç rotayı elde çözüyoruz. Hash kullanmamızın
 * nedeni: statik sunucuda derin bağlantıların çalışması için sunucu tarafında
 * yeniden yazma kuralı gerekmesin.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type Route =
  | { name: 'login' }
  | { name: 'channels' }
  | { name: 'game'; kingdomId: string }
  | { name: 'settings'; kingdomId: string | null }
  | { name: 'defeat'; kingdomId: string };

interface RouterValue {
  route: Route;
  navigate: (route: Route) => void;
  hrefOf: (route: Route) => string;
}

const RouterContext = createContext<RouterValue | null>(null);

function toHash(route: Route): string {
  switch (route.name) {
    case 'login':
      return '#/giris';
    case 'channels':
      return '#/channellar';
    case 'game':
      return `#/oyun/${route.kingdomId}`;
    case 'settings':
      return route.kingdomId ? `#/ayarlar/${route.kingdomId}` : '#/ayarlar';
    case 'defeat':
      return `#/yenilgi/${route.kingdomId}`;
  }
}

function fromHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [head, id] = parts;
  switch (head) {
    case 'channellar':
      return { name: 'channels' };
    case 'oyun':
      return id ? { name: 'game', kingdomId: id } : { name: 'channels' };
    case 'ayarlar':
      return { name: 'settings', kingdomId: id ?? null };
    case 'yenilgi':
      return id ? { name: 'defeat', kingdomId: id } : { name: 'channels' };
    case 'giris':
      return { name: 'login' };
    default:
      return { name: 'channels' };
  }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => fromHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(fromHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    const hash = toHash(next);
    if (window.location.hash === hash) setRoute(next);
    else window.location.hash = hash;
  }, []);

  const value = useMemo<RouterValue>(() => ({ route, navigate, hrefOf: toHash }), [route, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter, RouterProvider içinde kullanılmalı.');
  return ctx;
}
