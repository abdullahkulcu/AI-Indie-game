/**
 * Diplomatik olayların itibara etkisi.
 *
 * Saf kural tablosu: veritabanına, saate ve rastgeleliğe dokunmaz. Canlı motorun
 * (`engine/`) parçasıdır çünkü haraç turunu yürüten cron bunu her saat okuyor.
 * Eskiden `server/game/diplomacy.ts` içindeydi — hiç ayağa kalkmayan Fastify
 * yığınının içinde — ve canlı cron'un o yığına tek bağı buydu.
 */

export type DiplomaticEvent =
  | "kept_promise"
  | "fair_trade"
  | "defended_vassal"
  | "abandoned_vassal"
  | "broke_ceasefire"
  | "betrayal"
  | "rental_recall_under_siege";

/**
 * Değerler taşınırken KORUNDU; oyuncunun defterindeki itibar aynı hareket
 * ediyor. En ağırı sözünde durmamaktır: verilen sözün bozulması (ödenmeyen
 * haraç, bozulan anlaşma) 20 puan götürür.
 */
export const REPUTATION_CHANGES: Readonly<Record<DiplomaticEvent, number>> = {
  kept_promise: 2,
  fair_trade: 1,
  defended_vassal: 4,
  abandoned_vassal: -8,
  broke_ceasefire: -12,
  betrayal: -20,
  rental_recall_under_siege: -6,
};

export function reputationChange(event: DiplomaticEvent): number {
  return REPUTATION_CHANGES[event];
}
