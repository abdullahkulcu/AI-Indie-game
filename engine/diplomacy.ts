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
  | "rental_recall_under_siege"
  | "caught_agitating";

/**
 * Değerler taşınırken KORUNDU; oyuncunun defterindeki itibar aynı hareket
 * ediyor. En ağırı sözünde durmamaktır: verilen sözün bozulması (ödenmeyen
 * haraç, bozulan anlaşma) 20 puan götürür.
 *
 * `caught_agitating`: kesesi ya da haydut yönlendirmesi karşı-istihbarata
 * yakalanan Kralın itibar cezası. İmzalı barışı olan taraf için ayrıca
 * `betrayal` uygulanır ve anlaşma bozulur; ikisi ayrı olaydır.
 */
export const REPUTATION_CHANGES: Readonly<Record<DiplomaticEvent, number>> = {
  kept_promise: 2,
  fair_trade: 1,
  defended_vassal: 4,
  abandoned_vassal: -8,
  broke_ceasefire: -12,
  betrayal: -20,
  rental_recall_under_siege: -6,
  caught_agitating: -10,
};

export function reputationChange(event: DiplomaticEvent): number {
  return REPUTATION_CHANGES[event];
}
