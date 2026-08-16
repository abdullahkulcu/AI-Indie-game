/**
 * Krallık veri deposu.
 *
 * Sunucu her dakika tick attığı için WebSocket yerine yoklama (polling) yeterli:
 * çekirdek durum 10 saniyede bir, daha yavaş değişen listeler (bülten, pazar,
 * diplomasi, raporlar) 30 saniyede bir tazelenir. Sekme arka plandayken hiç
 * istek atılmaz — 8 saatlik açık sekme, sunucuya 3000 boş istek demek olmasın.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type {
  ActionResult,
  BattleReportDto,
  ChatMessageDto,
  DiplomacyThreadDto,
  KingdomStateDto,
  MarketOfferDto,
  NotificationDto,
  PendingDecisionDto,
  RealmViewDto,
  RegionBulletinDto,
} from '@krallik/shared';
import { api } from '../api/client';

const CORE_POLL_MS = 10_000;
/** Yavaş listeler kaç çekirdek turda bir tazelenir. */
const SLOW_EVERY = 3;

export interface KingdomStore {
  kingdomId: string;
  kingdom: KingdomStateDto | null;
  realm: RealmViewDto | null;
  chat: ChatMessageDto[];
  decisions: PendingDecisionDto[];
  notifications: NotificationDto[];
  bulletins: RegionBulletinDto[];
  market: MarketOfferDto[];
  diplomacy: DiplomacyThreadDto[];
  reports: BattleReportDto[];
  loading: boolean;
  error: string | null;
  refreshCore: () => Promise<void>;
  refreshSlow: () => Promise<void>;
  sendChat: (message: string) => Promise<void>;
  respondDecision: (decisionId: string, response: 'approve' | 'reject') => Promise<ActionResult>;
  runAction: (name: string, args: Record<string, unknown>) => Promise<ActionResult>;
  steerDiplomacy: (threadId: string, note: string) => Promise<ActionResult>;
  markNotificationRead: (notificationId: string) => Promise<void>;
}

const KingdomContext = createContext<KingdomStore | null>(null);

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Bilinmeyen bir hata oluştu.';
}

export function KingdomProvider({ kingdomId, children }: { kingdomId: string; children: ReactNode }) {
  const [kingdom, setKingdom] = useState<KingdomStateDto | null>(null);
  const [realm, setRealm] = useState<RealmViewDto | null>(null);
  const [chat, setChat] = useState<ChatMessageDto[]>([]);
  const [decisions, setDecisions] = useState<PendingDecisionDto[]>([]);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [bulletins, setBulletins] = useState<RegionBulletinDto[]>([]);
  const [market, setMarket] = useState<MarketOfferDto[]>([]);
  const [diplomacy, setDiplomacy] = useState<DiplomacyThreadDto[]>([]);
  const [reports, setReports] = useState<BattleReportDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Yavaş ağda yoklamaların üst üste binmesini engeller.
  const inFlight = useRef(false);

  const refreshCore = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [state, realmView, pending, notifs] = await Promise.all([
        api.kingdom.state(kingdomId),
        api.kingdom.realm(kingdomId),
        api.kingdom.decisions(kingdomId),
        api.kingdom.notifications(kingdomId),
      ]);
      setKingdom(state);
      setRealm(realmView);
      setDecisions(pending);
      setNotifications(notifs);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [kingdomId]);

  const refreshSlow = useCallback(async () => {
    try {
      const [bulletinList, offers, threads, battleReports] = await Promise.all([
        api.kingdom.bulletins(kingdomId),
        api.kingdom.market(kingdomId),
        api.kingdom.diplomacy(kingdomId),
        api.kingdom.reports(kingdomId),
      ]);
      setBulletins(bulletinList);
      setMarket(offers);
      setDiplomacy(threads);
      setReports(battleReports);
    } catch {
      // Yavaş listeler kritik değil: çekirdek durum ayakta kaldığı sürece
      // hatayı üst banda taşımıyoruz, bir sonraki turda yeniden denenir.
    }
  }, [kingdomId]);

  // İlk yükleme: sohbet geçmişi yalnızca burada çekilir, sonrası artımlıdır.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refreshCore();
    void refreshSlow();
    api.kingdom
      .chatHistory(kingdomId)
      .then((history) => {
        if (!cancelled) setChat(history);
      })
      .catch(() => {
        /* sohbet geçmişi yoksa boş başlarız */
      });
    return () => {
      cancelled = true;
    };
  }, [kingdomId, refreshCore, refreshSlow]);

  useEffect(() => {
    let tick = 0;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      tick += 1;
      void refreshCore();
      if (tick % SLOW_EVERY === 0) void refreshSlow();
    }, CORE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshCore, refreshSlow]);

  const sendChat = useCallback(
    async (message: string) => {
      // İyimser ekleme: Kral'ın buyruğu General yanıtlamadan önce görünür.
      const optimistic: ChatMessageDto = {
        id: `local-${Date.now()}`,
        role: 'king',
        content: message,
        createdAt: new Date().toISOString(),
        actions: [],
        isPassiveSummary: false,
      };
      setChat((prev) => [...prev, optimistic]);
      const res = await api.kingdom.sendChat(kingdomId, message);
      setChat((prev) => [...prev.filter((m) => m.id !== optimistic.id), ...res.messages]);
      setDecisions(res.pendingDecisions);
      void refreshCore();
    },
    [kingdomId, refreshCore],
  );

  const respondDecision = useCallback(
    async (decisionId: string, response: 'approve' | 'reject') => {
      const result = await api.kingdom.respondToDecision(kingdomId, decisionId, response);
      setDecisions((prev) => prev.filter((d) => d.id !== decisionId));
      void refreshCore();
      return result;
    },
    [kingdomId, refreshCore],
  );

  const runAction = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      const result = await api.kingdom.action(kingdomId, name, args);
      void refreshCore();
      return result;
    },
    [kingdomId, refreshCore],
  );

  const steerDiplomacy = useCallback(
    async (threadId: string, note: string) => {
      const result = await api.kingdom.steerDiplomacy(kingdomId, threadId, note);
      void refreshSlow();
      return result;
    },
    [kingdomId, refreshSlow],
  );

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      await api.kingdom.markNotificationRead(kingdomId, notificationId);
    },
    [kingdomId],
  );

  const value = useMemo<KingdomStore>(
    () => ({
      kingdomId,
      kingdom,
      realm,
      chat,
      decisions,
      notifications,
      bulletins,
      market,
      diplomacy,
      reports,
      loading,
      error,
      refreshCore,
      refreshSlow,
      sendChat,
      respondDecision,
      runAction,
      steerDiplomacy,
      markNotificationRead,
    }),
    [
      kingdomId,
      kingdom,
      realm,
      chat,
      decisions,
      notifications,
      bulletins,
      market,
      diplomacy,
      reports,
      loading,
      error,
      refreshCore,
      refreshSlow,
      sendChat,
      respondDecision,
      runAction,
      steerDiplomacy,
      markNotificationRead,
    ],
  );

  return <KingdomContext.Provider value={value}>{children}</KingdomContext.Provider>;
}

export function useKingdom(): KingdomStore {
  const ctx = useContext(KingdomContext);
  if (!ctx) throw new Error('useKingdom, KingdomProvider içinde kullanılmalı.');
  return ctx;
}
