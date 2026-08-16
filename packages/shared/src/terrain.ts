/**
 * Arazi sistemi — GDD §3.
 *
 * Her tile bir arazi tipine sahip ve bu hem üretimi hem savaşı etkiler.
 * Krallığın başkenti hangi arazi üzerine kurulduysa, o krallığın doğal
 * ekonomik/askeri eğilimi şekillenir (dağlık başkent = güçlü savunma, yavaş
 * ekonomi).
 */

import type { TerrainType } from './types.js';

export interface TerrainDef {
  type: TerrainType;
  nameTr: string;
  /** Savunan tarafın güç çarpanı. */
  defenseMultiplier: number;
  /** Saldıran ordunun bu tile'a yürürken yavaşlama katsayısı (>1 = yavaş). */
  marchSlowdown: number;
  /** Kuşatma birimlerinin bu arazide etkinlik çarpanı. */
  siegeEffectiveness: number;
  /** Bu arazide savunan tarafın alabileceği ek taktik bonusu. */
  favoredTactic?: 'ambush' | 'terrain_advantage' | 'withdraw_to_keep';
  /**
   * Uzun kuşatmalarda saldıran orduya round başına uygulanan yıpranma
   * (susuzluk/erzak). Çöl/kıraç arazide belirgindir.
   */
  attackerAttritionPerRound: number;
  /**
   * Dar boğaz etkisi: savunanın etkin gücü, saldıranın sayı üstünlüğünün
   * bu oranla sınırlanmasıyla hesaplanır. 1.0 = etkisiz.
   */
  chokepointFactor: number;
  descriptionTr: string;
}

export const TERRAIN: Record<TerrainType, TerrainDef> = {
  plains: {
    type: 'plains',
    nameTr: 'Ova',
    defenseMultiplier: 1.0,
    marchSlowdown: 1.0,
    siegeEffectiveness: 1.0,
    attackerAttritionPerRound: 0,
    chokepointFactor: 1.0,
    descriptionTr: 'Tahıl üretimi standart. Nötr savaş alanı; süvari hareketi hızlıdır.',
  },
  forest: {
    type: 'forest',
    nameTr: 'Orman',
    defenseMultiplier: 1.18,
    marchSlowdown: 1.15,
    siegeEffectiveness: 0.85,
    favoredTactic: 'ambush',
    attackerAttritionPerRound: 0.005,
    chokepointFactor: 1.0,
    descriptionTr: 'Odun üretimi yüksek, tahıl düşük. Savunan tarafa pusu bonusu verir.',
  },
  mountain: {
    type: 'mountain',
    nameTr: 'Dağ',
    defenseMultiplier: 1.35,
    marchSlowdown: 1.4,
    siegeEffectiveness: 0.6,
    favoredTactic: 'terrain_advantage',
    attackerAttritionPerRound: 0.01,
    chokepointFactor: 0.85,
    descriptionTr: 'Taş/maden üretimi yüksek, tahıl düşük. Kuşatma birimleri yavaşlar, savunan güçlenir.',
  },
  riverbank: {
    type: 'riverbank',
    nameTr: 'Nehir Kenarı',
    defenseMultiplier: 1.12,
    marchSlowdown: 1.25,
    siegeEffectiveness: 0.95,
    attackerAttritionPerRound: 0,
    chokepointFactor: 1.0,
    descriptionTr: 'Tarım verimi ve değirmen/bira imalathanesi bonusu. Nehir geçişi saldıranı yavaşlatır.',
  },
  pass: {
    type: 'pass',
    nameTr: 'Geçit',
    defenseMultiplier: 1.25,
    marchSlowdown: 1.2,
    siegeEffectiveness: 0.75,
    favoredTactic: 'withdraw_to_keep',
    attackerAttritionPerRound: 0.008,
    // Dar boğazda saldıranın sayı üstünlüğü ciddi biçimde kısıtlanır:
    // az sayıda savunmacı büyük bir orduyu durdurabilir.
    chokepointFactor: 0.6,
    descriptionTr: 'Dar boğaz. Az sayıda savunmacı çok daha büyük bir orduyu durdurabilir — kale için stratejik konum.',
  },
  barren: {
    type: 'barren',
    nameTr: 'Kıraç Ova',
    defenseMultiplier: 0.95,
    marchSlowdown: 1.05,
    siegeEffectiveness: 1.05,
    // Su kaynağına uzaklık: uzun kuşatmalarda saldıranı yıpratan tek arazi.
    attackerAttritionPerRound: 0.028,
    chokepointFactor: 1.0,
    descriptionTr: 'Genel üretim düşük. Su kaynağına uzak — uzun kuşatmalarda saldıran ordu yıpranır.',
  },
};

export function terrainDef(type: TerrainType): TerrainDef {
  return TERRAIN[type];
}

/**
 * Harita üretiminde arazi dağılımı. Merkeze yakın tile'lar daha değerli ama
 * kısıtlı (dağ/geçit/nehir), kenarlar daha bol ama az verimli (ova/kıraç)
 * olacak şekilde ağırlıklandırılır — GDD §2.
 */
export const TERRAIN_WEIGHTS_CORE: ReadonlyArray<[TerrainType, number]> = [
  ['plains', 26],
  ['riverbank', 22],
  ['mountain', 20],
  ['forest', 18],
  ['pass', 10],
  ['barren', 4],
];

export const TERRAIN_WEIGHTS_RIM: ReadonlyArray<[TerrainType, number]> = [
  ['plains', 38],
  ['forest', 22],
  ['barren', 18],
  ['riverbank', 10],
  ['mountain', 9],
  ['pass', 3],
];
