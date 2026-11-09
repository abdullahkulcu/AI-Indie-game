/**
 * Savaş sırasında halkın kendi iradesiyle verdiği tepki.
 *
 * Kurallar salt girdiden sonuç üretir. Böylece hem sefer ilanında hem de
 * sonuç çözümünde aynı halk durumu okunur; LLM metni yalnız bunu anlatır.
 */
export type CivicWarResponse = "support" | "watch" | "pressure";

export type CivicResponse = {
  id: CivicWarResponse;
  moraleBonus: number;
  /** Halkın kendiliğinden tavrı, savunma Generalinin geri çekilme çizgisini değiştirir. */
  withdrawThreshold: number;
  action: string;
  label: string;
  report: string;
};

export function warDisruptionForDefense(input: { severity: number; speed: number; now: number; previous?: { until: number; productionPenalty: number } }) {
  const severity = Math.max(1, Math.floor(input.severity));
  const productionPenalty = Math.min(.4, Math.max(input.previous?.productionPenalty ?? 0, .04 + severity * .018));
  const gameHours = Math.min(48, 8 + severity * 2);
  const until = input.now + gameHours * 3_600_000 / Math.max(1, input.speed);
  return { until: Math.max(input.previous?.until ?? 0, until), productionPenalty };
}

export function civicResponseForDefense(input: {
  popularity: number;
  factionPressure?: number;
  food: number;
  soldierUnrest?: number;
}): CivicResponse {
  const popularity = Math.max(0, Math.min(100, input.popularity));
  const pressure = Math.max(0, Math.min(100, input.factionPressure ?? 0));
  const unrest = Math.max(0, Math.min(100, input.soldierUnrest ?? 0));
  if (popularity >= 65 && pressure < 35 && unrest < 45 && input.food >= 100) {
    return { id: "support", moraleBonus: 8, withdrawThreshold: 40, action: "Mahalle savunması", label: "Halk desteği", report: "Mahalleler erzak ve yaralı bakımı için örgütlendi; garnizonun morali yükseldi ve hat daha uzun tutulacak." };
  }
  if (popularity < 40 || pressure >= 60 || unrest >= 65 || input.food < 50) {
    return { id: "pressure", moraleBonus: -6, withdrawThreshold: 60, action: "Barış heyeti", label: "Barış baskısı", report: "Aileler kayıp korkusuyla barış ve güvenlik talebini yükseltiyor; garnizon daha erken geri çekilme çizgisine alındı." };
  }
  return { id: "watch", moraleBonus: 0, withdrawThreshold: 50, action: "Mahalle nöbeti", label: "Temkinli bekleyiş", report: "Mahalleler sınır haberlerini izlemek için nöbet düzeni kurdu; savunma çizgisi değişmedi." };
}

export function defenderWarAftermath(input: {
  objective: "raid" | "concession" | "siege";
  defenderUnitsBefore: number;
  defenderLosses: number;
  loot: { gold: number; food: number };
  civicResponse: CivicWarResponse;
  popularity: number;
  factionPressure?: number;
}) {
  const lossRate = input.defenderUnitsBefore > 0 ? Math.max(0, Math.min(1, input.defenderLosses / input.defenderUnitsBefore)) : 0;
  const lootShock = input.loot.gold > 0 || input.loot.food > 0 ? 2 : 0;
  const siegeShock = input.objective === "siege" ? 4 : 0;
  const supportRelief = input.civicResponse === "support" ? 2 : 0;
  const pressurePenalty = input.civicResponse === "pressure" ? 2 : 0;
  const severity = Math.max(1, Math.round(2 + lossRate * 24 + lootShock + siegeShock + pressurePenalty - supportRelief));
  return {
    popularity: Math.max(0, Math.min(100, input.popularity - severity)),
    factionPressure: Math.max(0, Math.min(100, (input.factionPressure ?? 0) + Math.max(1, Math.round(severity * .7)))),
    severity,
  };
}
