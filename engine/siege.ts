/** Kuşatma hesabı: zamanla değişmeyen girdilerden tek sonuç üretir. */
import { armyUpkeep, unitCatalog } from "./units";
import { normalizeCampaignUnits, type CampaignUnits } from "./march";

/** İlk sürümde kuşatmanın kapalı çözümle hesaplanan oyun süresi. */
export const SIEGE_GAME_HOURS = 6;

/** Sefer rasyonu barış rasyonunun iki katıdır; saat sayısı tek seferde hesaplanır. */
export function siegeFoodCost(units: CampaignUnits, gameHours = SIEGE_GAME_HOURS) {
  return Math.max(0, Math.ceil(armyUpkeep(normalizeCampaignUnits(units)).food * 2 * Math.max(0, gameHours)));
}

export type SiegeResult = {
  attackerPressure: number;
  defenderStrength: number;
  progress: number;
  attackerLossRate: number;
  defenderLossRate: number;
  attackerWon: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Kuşatma yalnızca belirlenmiş süre sonunda çözülür; ara cron çağrılarının
 * sayısı sonucu değiştirmez. Kuşatma ekibi baskının ana kaynağıdır, fakat
 * piyade olmadan sura yaklaşamaz.
 */
export function resolveSiege(input: {
  attacker: CampaignUnits;
  defender: CampaignUnits;
  keepLevel: number;
  wallLevel: number;
  attackerSupplyRatio: number;
  defenderSupplyRatio?: number;
}) : SiegeResult {
  const attacker = normalizeCampaignUnits(input.attacker);
  const defender = normalizeCampaignUnits(input.defender);
  const siegePower = unitCatalog.reduce((sum, unit) => sum + (attacker[unit.type] ?? 0) * unit.siege, 0);
  const infantry = (attacker.spearman ?? 0) + (attacker.swordsman ?? 0) + (attacker.archer ?? 0);
  const defenderPower = unitCatalog.reduce((sum, unit) => sum + (defender[unit.type] ?? 0) * unit.defense, 0);
  const attackerPressure = (siegePower * 1.8 + infantry * 1.1) * (.55 + clamp(input.attackerSupplyRatio, 0, 1) * .45);
  const fortification = 70 + Math.max(0, input.keepLevel) * 40 + Math.max(0, input.wallLevel) * 55;
  const defenderStrength = (fortification + defenderPower) * (.65 + clamp(input.defenderSupplyRatio ?? 1, 0, 1) * .35);
  const progress = clamp(100 * attackerPressure / Math.max(1, attackerPressure + defenderStrength * .8), 0, 100);
  return {
    attackerPressure,
    defenderStrength,
    progress,
    attackerLossRate: clamp(.06 + defenderStrength / Math.max(1, attackerPressure) * .05, .05, .18),
    defenderLossRate: clamp(.04 + attackerPressure / Math.max(1, defenderStrength) * .07, .04, .2),
    attackerWon: progress >= 52,
  };
}
