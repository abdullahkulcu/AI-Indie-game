/** Savaş emrinin değişmeyen kelime dağarcığı ve güvenli sınırları. */
import type { Side, Terms } from "./negotiation";
export const WAR_OBJECTIVES = ["raid", "concession", "siege", "blockade"] as const;
export type WarObjective = typeof WAR_OBJECTIVES[number];

export const WAR_APPROACHES = ["cautious", "balanced", "intense"] as const;
export type WarApproach = typeof WAR_APPROACHES[number];

export const DEFENSE_DOCTRINES = ["cautious", "balanced", "hard_response"] as const;
export type DefenseDoctrine = typeof DEFENSE_DOCTRINES[number];

export const WAR_STATUSES = ["gathering", "marching", "engaged", "siege", "blockade", "returning", "resolved", "cancelled"] as const;
export type WarStatus = typeof WAR_STATUSES[number];

/** Aynı hedefe yeniden sefer açmadan önce iki oyun saati beklenir. */
export const WAR_TARGET_COOLDOWN_GAME_HOURS = 2;
export function warTargetCooldownMs(channelSpeed: number) {
  return WAR_TARGET_COOLDOWN_GAME_HOURS * 3_600_000 / Math.max(1, Number(channelSpeed) || 1);
}

/** Başkentteki taze karşı-istihbaratın savaş ilanını erken haber verebildiği pencere. */
export const COUNTER_INTEL_FRESH_GAME_HOURS = 72;
export function counterIntelFreshWindowMs(channelSpeed: number) {
  return COUNTER_INTEL_FRESH_GAME_HOURS * 3_600_000 / Math.max(1, Number(channelSpeed) || 1);
}

/**
 * Savunan, taze ajan raporuyla ordu toplanırken; aksi halde sınır gözcüleri
 * yürüyüş başladığında tehdidi öğrenir. Bu zaman damgası savaş satırında
 * kalır; sonradan gelen yeni bir ajan eski ilanı geriye dönük açığa çıkarmaz.
 */
export function defenderAlertAt(now: number, departsAt: number, hasFreshCounterIntel: boolean) {
  return hasFreshCounterIntel ? now : Math.max(now, departsAt);
}

/** Geri çekilen orduyu takipte iki tarafın maruz kaldığı sınırlı kayıp oranı. */
export function pursuitLossRates(pursuer: Record<string, number>, retreating: Record<string, number>) {
  const count = (units: Record<string, number>) => Object.values(units).reduce((sum, value) => sum + Math.max(0, Math.floor(Number(value) || 0)), 0);
  const pursuerTotal = count(pursuer), retreatingTotal = count(retreating);
  if (!pursuerTotal || !retreatingTotal) return { retreating: 0, pursuer: 0 };
  const pursuerCavalry = Math.max(0, Math.floor(Number(pursuer.cavalry) || 0)) / pursuerTotal;
  const retreatingCavalry = Math.max(0, Math.floor(Number(retreating.cavalry) || 0)) / retreatingTotal;
  return {
    retreating: Math.min(.22, .04 + pursuerCavalry * .18),
    pursuer: Math.min(.12, .015 + retreatingCavalry * .1),
  };
}

/** Başarılı savunmanın halk ve komşular nezdindeki itibarı; tavanı aşmaz. */
export const DEFENSE_VICTORY_REPUTATION = 3;
export function defendedReputation(reputation: number, won: boolean) {
  const current = Math.max(0, Math.min(100, Number(reputation) || 0));
  return won ? Math.min(100, current + DEFENSE_VICTORY_REPUTATION) : current;
}

/** Oyuncu geri çekilme eşiğini bu aralığın dışında veremez. */
export const MIN_WITHDRAW_THRESHOLD = 20;
export const MAX_WITHDRAW_THRESHOLD = 80;
/** Kralın ilk temasta orduya verdiği moral etkisi. */
export const KING_LEADS_MORALE_BONUS = 6;

/** Kral cephedeyken başkentin her 24 oyun saatindeki siyasi yıpranması. */
export function kingAbsencePenalty(kingLeads: boolean, elapsedGameHours: number) {
  if (!kingLeads) return 0;
  return Math.min(8, Math.floor(Math.max(0, elapsedGameHours) / 24));
}

/** Bir ikmal konvoyunun sağladığı moral, tek bağışla savaşı belirlemesin diye sınırlıdır. */
export function supportMoraleBonus(food: number) {
  return Math.min(4, Math.max(1, Math.ceil(Math.max(0, Math.floor(food)) / 250)));
}

/**
 * Tarafsız bir Krallığın savaşta aldığı tutum, sonraki diplomasi için görünen
 * itibarına hemen yazılır. Savunmaya insani yardım sınırlı bir güven kazanımı;
 * saldırıyı ikmal etmek veya rota açmak ise sınırlı bir siyasi bedeldir.
 */
export function warSupportReputationChange(kind: "supply" | "troops" | "passage", side: "attacker" | "defender") {
  if (kind === "passage" || side === "attacker") return -1;
  return 1;
}

/** Dış savaş desteğinin iki savaşan Krallıkla ilişki hafızasına etkisi. */
export function warSupportRelationChanges(kind: "supply" | "troops" | "passage", side: "attacker" | "defender") {
  const supported = side;
  const opposed = supported === "attacker" ? "defender" : "attacker";
  const aid = kind === "troops" ? 12 : kind === "supply" ? 8 : 6;
  return { supported, opposed, supportedChange: aid, opposedChange: -aid } as const;
}

/**
 * Elçi yoldayken taraflar mevziyi korur; savaş durmaz fakat sonraki tırmanma
 * eşiği kısa süre ertelenir. Uzak savaşta bu süre de artar, fakat hiçbir rota
 * tek bir açık belgeyle sonsuza kadar dondurulamaz.
 */
export function truceEscalationDelayMs(oneWayMarchMs: number) {
  const route = Math.max(0, Math.floor(Number(oneWayMarchMs) || 0));
  return Math.max(60_000, Math.min(20 * 60_000, Math.round(route * .1)));
}

export function isWarObjective(value: unknown): value is WarObjective {
  return (WAR_OBJECTIVES as readonly string[]).includes(String(value));
}

export function isWarApproach(value: unknown): value is WarApproach {
  return (WAR_APPROACHES as readonly string[]).includes(String(value));
}

export function isDefenseDoctrine(value: unknown): value is DefenseDoctrine {
  return (DEFENSE_DOCTRINES as readonly string[]).includes(String(value));
}

export function clampWithdrawThreshold(value: unknown): number {
  const parsed = Math.round(Number(value) || 50);
  return Math.max(MIN_WITHDRAW_THRESHOLD, Math.min(MAX_WITHDRAW_THRESHOLD, parsed));
}

/**
 * Savaş puanının barış masasına taşınan ilk şartı. Puan saldıranın açısından
 * tutulur; savunan taraf teklif açtığında işaret ters çevrilir. Bu kuralla
 * ekranın gösterdiği baskı ile sunucunun yazdığı haraç şartı ayrışmaz.
 */
export function peaceTermsForWar(side: Side, warPoints: number): { leverage: number; terms: Terms } {
  const leverage = side === "initiator" ? warPoints : -warPoints;
  if (leverage < 10) return { leverage, terms: { topic: "non_aggression", hours: 24, everyHours: 6 } };
  const payerSide: Side = side === "initiator" ? "target" : "initiator";
  return {
    leverage,
    terms: {
      topic: "tribute", payerSide, resource: "gold",
      tributeAmount: Math.min(5_000, Math.max(50, leverage * 10)), hours: 24, everyHours: 6,
    },
  };
}
