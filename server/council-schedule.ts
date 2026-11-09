import { publicCouncilCues, type CouncilSnapshot } from "./council-advisors";
/** Olağan Divan ritmi channel hızından bağımsız, gerçek dünyada on iki saattir. */
export const COUNCIL_CYCLE_REAL_HOURS = 12;

/** Kralın çağrısı da iki oturumun arka arkaya gelmesine izin vermez. */
export const COUNCIL_CALL_MINIMUM_REAL_HOURS = 12;

const HOUR_MS = 3_600_000;

/** Divan takvimi bir oyun günüyle hızlanmaz; tüm krallıklar için aynı ritimdedir. */
export function councilCycleMs(speed?: number) {
  void speed;
  return COUNCIL_CYCLE_REAL_HOURS * HOUR_MS;
}

/** Çağrı yapıldığında toplantının peş peşe açılmasını engeller. */
export function councilCallMinimumGapMs(speed?: number) {
  void speed;
  return COUNCIL_CALL_MINIMUM_REAL_HOURS * HOUR_MS;
}

/** Kaynakların saniyelik oynaması değil, karar bağlamının değişmesi yeni gündem doğurur. */
export function councilSourceKey(snapshot: CouncilSnapshot) {
  const cues = publicCouncilCues(snapshot);
  const foodRate = Number(snapshot.hourlyRates?.food ?? 0);
  const army = Number(snapshot.populace?.army ?? 0);
  const construction = snapshot.activeConstruction?.name ?? "";
  return JSON.stringify({
    commons: [cues.commons.id, cues.commons.priority],
    garrison: [cues.garrison.id, cues.garrison.priority],
    general: [foodRate < 0 ? "food-deficit" : "food-safe", army <= 0 ? "no-army" : "army", construction, String(snapshot.strategyNote ?? "")],
  });
}
