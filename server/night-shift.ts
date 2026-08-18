import { catalog, keepUpgradeCosts, MAX_KEEP_LEVEL } from "../engine/catalog";
import { affordable, costFor, keep, rates } from "../engine/tick";
import type { Game } from "../engine/types";

/**
 * Gece vardiyasının token disiplini burada kurulur.
 *
 * Kural: LLM'e gitmeden önce kodda karar verilir. Yapılabilecek hiçbir şey
 * yoksa model hiç çağrılmaz ve o uyanma sıfır token harcar. Model yalnızca
 * gerçekten seçim gerektiren durumda, tek bir eylem için çağrılır.
 */

export type WakeDecision =
  | { act: false; reason: string }
  | { act: true; reason: string; options: string[]; emergency: string | null };

export type StandingOrder = {
  instruction: string;
  autonomy: "autonomous" | "ask";
  status: "pending_approval" | "active" | "paused";
  maxActionsPerWake: number;
  dailyActionCap: number;
  actionsToday: number;
  dayStartedAt: number;
  lastRunAt: number | null;
};

/** Uyanmalar arasındaki en kısa süre; cron daha sık çalışsa bile bu aralık korunur. */
export const WAKE_INTERVAL_MS = 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

/** Kralın acil müdahale beklediği durumlar; yalnızca aktif emir varken geçerlidir. */
export function detectEmergency(game: Game): string | null {
  const rate = rates(game);
  if (rate.food < 0) {
    const hours = game.resources.food / Math.abs(rate.food);
    if (hours <= 6) return `Yiyecek ${Math.floor(hours)} saat içinde tükeniyor.`;
  }
  if (game.popularity < 20) return `Halkın rızası ${Math.round(game.popularity)} puana düştü; isyan eşiğindeyiz.`;
  const protectionHoursLeft = (game.protectionEndsAt - game.lastTickAt) / 3_600_000;
  const army = Object.values(game.units).reduce((total, amount) => total + amount, 0);
  if (protectionHoursLeft > 0 && protectionHoursLeft <= 12 && army === 0) return "Koruma bitmek üzere ve tek askerimiz yok.";
  return null;
}

/** Şu an gerçekten başlatılabilecek inşa/eğitim seçenekleri; boşsa modeli çağırmaya gerek yok. */
export function affordableOptions(game: Game): string[] {
  if (game.queue) return [];
  const level = keep(game), options: string[] = [];

  if (level < MAX_KEEP_LEVEL && affordable(game.resources, keepUpgradeCosts[level])) {
    options.push(`keep→Sv.${level + 1}`);
  }
  for (const item of catalog) {
    if (item.unlock > level) continue;
    const current = game.buildings.find(b => b.type === item.type)?.level ?? 0;
    if (affordable(game.resources, costFor(item.cost, current))) options.push(`${item.type}→Sv.${current + 1}`);
  }
  if (game.buildings.some(b => b.type === "barracks")) {
    const cost = { gold: 8 * 5, food: 10 * 5, iron: 5 };
    if (affordable(game.resources, cost) && game.population - 5 >= 20) options.push("spearman×5");
  }
  return options;
}

/**
 * Bu uyanmada model çağrılmalı mı? Yalnızca `act: true` dönerse token harcanır.
 */
export function shouldWake(order: StandingOrder, game: Game, now: number): WakeDecision {
  if (order.status !== "active") return { act: false, reason: "Kral gece yetkisini henüz onaylamadı." };
  if (order.lastRunAt !== null && now - order.lastRunAt < WAKE_INTERVAL_MS) {
    return { act: false, reason: "Bu saatlik dilimde zaten uyanıldı." };
  }
  const withinSameDay = now - order.dayStartedAt < DAY_MS;
  if (withinSameDay && order.actionsToday >= order.dailyActionCap) {
    return { act: false, reason: "Günlük eylem tavanına ulaşıldı." };
  }
  if (game.queue) return { act: false, reason: "Kuyruk dolu; yeni iş başlatılamaz." };

  const emergency = detectEmergency(game);
  const options = affordableOptions(game);
  if (!options.length) return { act: false, reason: "Karşılanabilir hiçbir emir yok." };

  return {
    act: true,
    reason: emergency ? `Acil durum: ${emergency}` : "Kalıcı emir için uygun seçenek var.",
    options,
    emergency,
  };
}

/** Günlük sayaç penceresi dolduysa sıfırlanır. */
export function rollDailyWindow(order: StandingOrder, now: number) {
  return now - order.dayStartedAt >= DAY_MS
    ? { actionsToday: 0, dayStartedAt: now }
    : { actionsToday: order.actionsToday, dayStartedAt: order.dayStartedAt };
}

/**
 * Gece vardiyası için sıkıştırılmış bağlam. Tam KRALLIK_DURUMU yerine yalnızca
 * karar için gereken alanlar gönderilir; tipik olarak birkaç yüz token.
 */
export function compactContext(game: Game, order: StandingOrder, decision: Extract<WakeDecision, { act: true }>) {
  const rate = rates(game);
  const round = (value: number) => Math.round(value);
  return {
    emir: order.instruction,
    acil: decision.emergency,
    secenekler: decision.options,
    kale: keep(game),
    nufus: round(game.population),
    riza: round(game.popularity),
    kaynak: {
      altin: round(game.resources.gold), yiyecek: round(game.resources.food), tas: round(game.resources.stone),
      odun: round(game.resources.wood), demir: round(game.resources.iron),
    },
    saatlik: { altin: round(rate.gold), yiyecek: round(rate.food), tas: round(rate.stone), odun: round(rate.wood), demir: round(rate.iron) },
  };
}
