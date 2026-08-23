import { rand01 } from "./raids";

/**
 * AJAN GÖREVLERİNİN KURALLARI — bedel, ihtimaller, süre ve zar.
 *
 * NEDEN AYRI BİR DOSYA: bu sayılar bugüne kadar `app/api/world/route.ts`'in
 * içinde tek satıra gömülüydü (`successChance = defended ? 3 : 10`). Görev
 * türü ikiye çıktığı an (keşif / derin gözetleme) aynı satırın iki kopyası
 * doğacaktı; CLAUDE.md'nin tek-doğru-kaynak ilkesi gereği tablo motora alındı.
 * Uç yalnızca "hangi tür, hedef korunuyor mu" der; kaç ihtimal, kaç altın ve
 * kaç saniye sorularının cevabı BURADA yaşar.
 *
 * Saf: `Math.random()`, `Date.now()` ve `crypto` KULLANILMAZ (bkz. CLAUDE.md
 * kısıt #1, `eslint.config.mjs` içindeki `engine/**` bloğu bunu denetler).
 */

export type IntelMissionKind = "scout" | "deep";

/** Şema kısıtı ve uç doğrulaması aynı listeden okur; ikinci bir kopya yok. */
export const INTEL_MISSION_KINDS = ["scout", "deep"] as const;

export function isIntelMissionKind(value: unknown): value is IntelMissionKind {
  return typeof value === "string" && (INTEL_MISSION_KINDS as readonly string[]).includes(value);
}

/**
 * GÖREV TÜRLERİ.
 *
 * `scout` satırındaki sayılar, bu dosya yazılmadan önce route'un içinde duran
 * değerlerin BİREBİR aynısıdır — mevcut keşif dengesi bilinçli olarak
 * değiştirilmedi, yalnızca yeri değişti.
 *
 * `deep` (DERİN GÖZETLEME, plan belgesi Fikir 5) kararı gereği standart
 * keşfin bir parçası DEĞİL, ayrı ve daha riskli/pahalı bir görevdir: bedeli
 * altındır, başarı ihtimali daha düşüktür, tespit edilme ihtimali daha
 * yüksektir ve ajan yolda daha uzun kalır.
 */
export const INTEL_MISSIONS: Record<IntelMissionKind, {
  label: string;
  /** Gönderilirken gönderenin ambarından düşen altın. Keşif bedavadır. */
  goldCost: number;
  /** Başarı ihtimali (%); hedefin karşı-istihbaratı ayaktaysa "defended". */
  success: { open: number; defended: number };
  /** Tespit ihtimali (%): başarısız bile olsa ajan yakalanabilir. */
  detection: { open: number; defended: number };
  /** Yol süresi çarpanı; taban süre `INTEL_TRAVEL_BASE_MS`. */
  travel: number;
}> = {
  scout: {
    label: "Keşif",
    goldCost: 0,
    success: { open: 10, defended: 3 },
    detection: { open: 30, defended: 75 },
    travel: 1,
  },
  deep: {
    label: "Derin Gözetleme",
    goldCost: 300,
    success: { open: 6, defended: 2 },
    detection: { open: 60, defended: 90 },
    travel: 3,
  },
};

/** Ajanın yolda geçirdiği taban süre; channel hızıyla kısalır. */
export const INTEL_TRAVEL_BASE_MS = 90_000;
export const INTEL_TRAVEL_MIN_MS = 15_000;

export function intelTravelMs(kind: IntelMissionKind, speed: number) {
  const base = INTEL_TRAVEL_BASE_MS * INTEL_MISSIONS[kind].travel;
  return Math.max(INTEL_TRAVEL_MIN_MS, Math.round(base / Math.max(1, speed || 1)));
}

export function intelChances(kind: IntelMissionKind, defended: boolean) {
  const mission = INTEL_MISSIONS[kind];
  return {
    successChance: defended ? mission.success.defended : mission.success.open,
    detectionChance: defended ? mission.detection.defended : mission.detection.open,
  };
}

/**
 * GÖREVİN ZARI — tohumlu, `engine/raids.ts` → `rand01` deseniyle.
 *
 * İSTİSMAR NOTU (önemli): tohum SUNUCUDA üretilen görev kimliğini (UUID)
 * içerir. Motor istemciye de paketlendiği için `rand01`'in kendisi oyuncuya
 * açıktır; tohum tahmin edilebilir bir şeyden (hedef kimliği + saat gibi)
 * kurulsaydı Kral görevi göndermeden önce sonucu hesaplayıp yalnızca kazanan
 * turlarda ajan yollardı. Görev kimliği hiçbir cevapta istemciye inmiyor
 * (`GET /api/world` yalnızca durum/süre/ihtimal döner), dolayısıyla zar
 * oyuncu için öngörülemez ama test ve tekrar-oynatma için deterministiktir.
 *
 * `succeeded` ile `detected` AYRI zarlardır: başarısız bir ajan da
 * yakalanabilir, başarılı bir ajan da fark edilmeden dönebilir.
 */
export function resolveIntelMission(input: {
  /** Sunucuda üretilen görev kimliği; tohumun öngörülemez parçası. */
  missionId: string;
  successChance: number;
  detectionChance: number;
  /** Hedefin kaydı okunamadıysa görev başarıya çevrilemez. */
  hasSnapshot: boolean;
}): { succeeded: boolean; detected: boolean; status: "succeeded" | "failed" | "detected" } {
  const succeeded = input.hasSnapshot && rand01(`${input.missionId}:basari`) * 100 < input.successChance;
  const detected = rand01(`${input.missionId}:tespit`) * 100 < input.detectionChance;
  // Sıra bugünkü route'un sırasıyla aynı: başarı tespitin önünde okunur, yani
  // başarılı bir ajan yakalanmış sayılmaz (bilgi geldi, iz de bırakmadı).
  return { succeeded, detected, status: succeeded ? "succeeded" : detected ? "detected" : "failed" };
}
