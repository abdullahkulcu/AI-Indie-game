/**
 * İstihbarat görevlerinin oyun kuralları.
 *
 * Ajanın ne kadar başarılı olduğu ve neyi raporlayacağı sunucuda kararlaştırılır;
 * bu modül yalnızca görev türlerinin dengelenmiş, saf kurallarını taşır. Böylece
 * arayüz "derin" görevi ucuz ya da risksizmiş gibi ayrı bir sayı uyduramaz.
 */

export const INTEL_MISSION_KINDS = ["scout", "deep_observation"] as const;
export type IntelMissionKind = typeof INTEL_MISSION_KINDS[number];

export const INTEL_MISSION_RULES: Record<IntelMissionKind, {
  goldCost: number;
  /** Normal keşfin yol süresine göre çarpan. */
  durationMultiplier: number;
  /** Hedefte karşı-istihbarat yokken başarı ve açığa çıkma olasılıkları. */
  open: { successChance: number; detectionChance: number };
  /** Hedefte aktif karşı-istihbarat varken olasılıklar. */
  defended: { successChance: number; detectionChance: number };
}> = {
  scout: {
    goldCost: 0,
    durationMultiplier: 1,
    open: { successChance: 10, detectionChance: 30 },
    defended: { successChance: 3, detectionChance: 75 },
  },
  deep_observation: {
    // Halkın nabzına kulak vermek daha çok insan, zaman ve rüşvet gerektirir.
    goldCost: 100,
    durationMultiplier: 2,
    open: { successChance: 5, detectionChance: 55 },
    defended: { successChance: 1, detectionChance: 90 },
  },
};

export function intelligenceTerms(kind: IntelMissionKind, defended: boolean) {
  const rule = INTEL_MISSION_RULES[kind];
  return { ...rule, ...(defended ? rule.defended : rule.open) };
}

/**
 * KALICI CASUS AĞI.
 *
 * Ağ tek seferlik keşif değildir: önce başarıyla keşfedilmiş bir hedefe sızar,
 * sonra düzenli rapor yeniler. Karşı-istihbarat bir zara değil, o an gerçekten
 * kurulu bir nöbete bakar; böylece hem Kral hem hedef neyin neden olduğunu
 * anlayabilir. Zaman dönüşümleri burada, diğer istihbarat kurallarıyla tek
 * yerde yaşar.
 */
export const SPY_NETWORK = {
  goldCost: 300,
  /** Ağın kurulma yolculuğu, oyun dakikası. */
  deploymentMinutes: 180,
  /** Ağ açık kaldıkça raporun yenilendiği oyun saati aralığı. */
  reportHours: 12,
} as const;

export const spyNetworkTravelMs = (channelSpeed: number) =>
  Math.max(30_000, Math.round(SPY_NETWORK.deploymentMinutes * 60_000 / Math.max(1, channelSpeed || 1)));

export const spyNetworkReportMs = (channelSpeed: number) =>
  Math.max(60_000, Math.round(SPY_NETWORK.reportHours * 3_600_000 / Math.max(1, channelSpeed || 1)));
