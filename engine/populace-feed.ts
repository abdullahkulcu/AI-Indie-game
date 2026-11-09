/**
 * HALKIN KAMUSAL GÜNLÜĞÜ — plan belgesi Fikir 7'nin saf karar katmanı.
 *
 * Bu modül bir talep ya da ceza üretmez. Yalnızca halkın kendi arasında
 * konuşmaya değer, görünür bir bağlam var mı sorusunu yanıtlar. Metni LLM
 * yazar; kalıcılık ve saatlik cron `server/populace-feed.ts` içindedir.
 */

export const FEED_REFRESH_MS = 6 * 3_600_000;

export const FEED_CUE_KINDS = ["food", "construction", "garrison", "opposition", "world", "neighbor"] as const;
export type FeedCueKind = typeof FEED_CUE_KINDS[number];

export type FeedCue = {
  kind: FeedCueKind;
  /** Modele giden kısa, sayısız konu tanımı. */
  subject: string;
};

export type FeedSignals = {
  foodRate: number;
  constructionName: string | null;
  soldierUnrest: number;
  factionPressure: number;
  worldEvent: { phase: "active" | "warning"; label: string };
  /** Anonim ve gizlilik eşiğini geçmiş channel kıyasından gelen yön bilgisi. */
  neighborWhisper: "better" | "worse" | null;
};

/**
 * En ağır konu tek satırı alır; altı ayrı şikâyetle halk panelini doldurmayız.
 * Sayısal eşikler burada tek yerdedir, anlatıcı yalnız bu kararı dillendirir.
 */
export function deriveFeedCue(input: FeedSignals): FeedCue | null {
  if (input.foodRate < 0) return { kind: "food", subject: "Pazar ve sofralarda yiyecek kaygısı konuşuluyor." };
  if (input.soldierUnrest >= 30) return { kind: "garrison", subject: "Kışlanın huzursuzluğu çarşıda konuşuluyor." };
  if (input.factionPressure >= 30) return { kind: "opposition", subject: "Meydanlarda muhalefetin sözü yayılıyor." };
  if (input.worldEvent.phase === "active") return { kind: "world", subject: `Diyarın içinden geçen ${input.worldEvent.label} halkın gündeminde.` };
  if (input.constructionName) return { kind: "construction", subject: "Yeni bir yapının yükselişi gündelik hayatın konuşulan işi." };
  if (input.neighborWhisper === "worse") return { kind: "neighbor", subject: "Adsız komşu sancaklardan daha rahat günler geçirildiği fısıldanıyor." };
  if (input.neighborWhisper === "better") return { kind: "neighbor", subject: "Adsız komşu sancaklarda da geçim sıkıntısının konuşulduğu fısıldanıyor." };
  return null;
}

/** Aynı saatlik pencerenin iki cron çağrısı aynı satırı üretir; DB onu tekilleştirir. */
export function feedSourceKey(cue: FeedCue, now: number) {
  return `${cue.kind}:${Math.floor(now / FEED_REFRESH_MS)}`;
}
