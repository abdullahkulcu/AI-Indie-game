import { affordable, buildOptions, keep, rates } from "../engine/tick";
import { constructionSlots } from "../engine/construction";
import type { Game, GameAction } from "../engine/types";
import { MAX_ACTIONS_PER_TURN } from "../engine/actions";
import { armySize, unitCatalog, unitCostFor } from "../engine/units";
import { deriveLedgerEvents, type LedgerKind } from "../engine/ledger";
import { worldEventSummary } from "../engine/world-events";
import { gameDayMs } from "../engine/game-time";

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

/** Gece vardiyası, General turunun güvenli üst sınırını asla aşmaz. */
export const NIGHT_ACTION_LIMITS = { min: 1, max: MAX_ACTIONS_PER_TURN } as const;

/** Eski veya bozuk satırlardaki sayıyı güvenli, uygulanabilir aralığa çeker. */
export function nightActionLimit(order: Pick<StandingOrder, "maxActionsPerWake" | "dailyActionCap" | "actionsToday">) {
  const perWake = Math.floor(Number(order.maxActionsPerWake) || 1);
  const dailyLeft = Math.max(0, Math.floor(Number(order.dailyActionCap) || 0) - Math.max(0, Math.floor(Number(order.actionsToday) || 0)));
  return Math.max(0, Math.min(NIGHT_ACTION_LIMITS.max, Math.max(NIGHT_ACTION_LIMITS.min, perWake), dailyLeft));
}

const NIGHT_ACTION_NAMES = new Set(["build_structure", "train_unit", "host_festival"]);

/**
 * Sağlayıcının tek araç çağrısından çıkan planı güvenli oyun eylemlerine indirger.
 * Eski tek-eylem yanıtları da okunur; böylece model değişimi gece vardiyasını
 * sessizce durdurmaz. Hiçbir uzak eylem ya da serbest araç gece planına sızamaz.
 */
export function plannedNightActions(proposal: GameAction | null, limit: number): GameAction[] {
  if (!proposal || proposal.name === "no_action" || limit < 1) return [];
  const raw = proposal.name === "night_plan" && Array.isArray(proposal.arguments.actions)
    ? proposal.arguments.actions
    : [proposal];
  const actions: GameAction[] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object") continue;
    const value = candidate as { name?: unknown; arguments?: unknown };
    const name = typeof value.name === "string" ? value.name : "";
    if (!NIGHT_ACTION_NAMES.has(name) || !value.arguments || typeof value.arguments !== "object" || Array.isArray(value.arguments)) continue;
    actions.push({ name, arguments: value.arguments as Record<string, unknown> });
    if (actions.length >= limit) break;
  }
  return actions;
}

/** Sonuç satırlarıyla aynı sıradaki başarılı eylemleri bulur. */
export function successfulNightActions(actions: GameAction[], results: string[]) {
  return actions.filter((_, index) => results[index]?.startsWith("✓"));
}

/** Uyanmalar arasındaki en kısa süre; cron daha sık çalışsa bile bu aralık korunur. */
export const WAKE_INTERVAL_MS = 60 * 60_000;

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
  // Maliyet TEK KAYNAKTAN okunur. Burada katalog + costFor + materialScaleOf
  // üçlüsü ayrıca hesaplanıyordu; panelden ve General'in bağlamından sapabilen
  // ikinci bir maliyet hesabıydı ve seviye tavanını da tanımıyordu.
  const options: string[] = [];
  const activeConstruction = game.constructionQueue?.filter(job => job.startedAt !== null).length
    ?? (game.queue?.kind === "building" ? 1 : 0);
  // Gece vardiyası Kralın açıkça kurduğu bekleme sırasını kendi başına
  // uzatmaz. Boş şantiye varsa inşaat önerir; doluysa token harcamaz.
  if (activeConstruction < constructionSlots(keep(game))) {
    for (const option of buildOptions(game)) {
      if (affordable(game.resources, option.cost)) options.push(`${option.type}→Sv.${option.nextLevel}`);
    }
  }
  const barracks = game.buildings.find(building => building.type === "barracks")?.level ?? 0;
  if (!game.trainingQueue && barracks > 0) {
    for (const unit of unitCatalog.filter(candidate => candidate.barracksLevel <= barracks)) {
      const count = 5, manpower = count * unit.manpower;
      if (affordable(game.resources, unitCostFor(unit.type, count)) && game.population - manpower >= 20) options.push(`${unit.type}×${count}`);
    }
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
  const withinSameDay = now - order.dayStartedAt < gameDayMs(game.speed);
  if (withinSameDay && order.actionsToday >= order.dailyActionCap) {
    return { act: false, reason: "Günlük eylem tavanına ulaşıldı." };
  }
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
export function rollDailyWindow(order: StandingOrder, now: number, speed = 1) {
  return now - order.dayStartedAt >= gameDayMs(speed)
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
    bu_uyanista_en_fazla_hamle: nightActionLimit(order),
    secenekler: decision.options,
    kale: keep(game),
    nufus: round(game.population),
    riza: round(game.popularity),
    kaynak: {
      altin: round(game.resources.gold), yiyecek: round(game.resources.food), tas: round(game.resources.stone),
      odun: round(game.resources.wood), demir: round(game.resources.iron),
    },
    saatlik: { altin: round(rate.gold), yiyecek: round(rate.food), tas: round(rate.stone), odun: round(rate.wood), demir: round(rate.iron) },
    dunya: (() => {
      const event = worldEventSummary(game, game.lastTickAt);
      return { durum: event.phase === "active" ? "sürüyor" : "yaklaşıyor", olay: event.label, not: event.advice };
    })(),
  };
}

/**
 * Gece vardiyasının gerçekten uygulanmış hamlesini General defterine çevirir.
 *
 * Burada yeni bir hafıza kuralı yoktur: Kral çevrimiçi iken kullanılan
 * `deriveLedgerEvents` okunur. Bu sayede çevrimdışı alınan bir eğitim emri ya
 * da şenlik, General'in ertesi gün hatırladığı krallık hikâyesinden kaybolmaz.
 * Çağıran bu sonucu yalnız bulut kaydı başarıyla yazıldıktan SONRA kalıcılar.
 */
export function nightLedgerEvents(game: Game, actionNames: string | string[]): LedgerKind[] {
  return deriveLedgerEvents({
    resources: game.resources,
    hourlyRates: rates(game),
    populace: {
      moodScore: game.popularity,
      foodRation: game.foodRation,
      soldierPay: game.soldierPay,
      soldierUnrest: game.soldierUnrest,
      army: armySize(game.units),
    },
    appliedActions: Array.isArray(actionNames) ? actionNames : [actionNames],
    kingOverrode: false,
    generalRefused: false,
    kingBackedDown: false,
    requestsMet: 0,
    requestsRefused: 0,
  });
}
