/**
 * Başka bir krallığın DIŞARIDAN görünen yüzü.
 *
 * İki ayrı sınır var ve ikisi de burada, TEK yerde çizilir:
 *  1. `PublicKingdom` — aynı channel'daki herkesin görebildiği kaba çerçeve
 *     (harita yerleşimi, ortak maden listesi, müzakere masasındaki isim).
 *  2. `IntelReport`   — BAŞARILI bir ajanın getirdiği rapor; `intel_missions.report`
 *     içinde JSON olarak saklanır ve keşfedilen krallık için arayüze döner.
 */

export type PublicKingdom = {
  id: string;
  name: string;
  ruler: string;
  terrain: string;
  keepLevel: number;
  population: number;
  buildingCount: number;
  army: number;
};

export function projectPublicKingdom(userId: string, gameState: string, expectedChannelName: string): PublicKingdom | null {
  try {
    const game = JSON.parse(gameState) as {
      kingdomName?: unknown;
      rulerName?: unknown;
      channel?: unknown;
      terrain?: unknown;
      population?: unknown;
      buildings?: Array<{ type?: unknown; level?: unknown }>;
      units?: Record<string, unknown>;
    };
    if (game.channel !== expectedChannelName || typeof game.kingdomName !== "string" || !game.kingdomName.trim()) return null;
    const buildings = Array.isArray(game.buildings) ? game.buildings : [];
    const keep = buildings.find(building => building?.type === "keep");
    return {
      id: userId,
      name: game.kingdomName.trim().slice(0, 36),
      ruler: typeof game.rulerName === "string" ? game.rulerName.trim().slice(0, 30) : "Bilinmeyen Hükümdar",
      terrain: typeof game.terrain === "string" ? game.terrain : "plain",
      keepLevel: Math.max(1, Math.min(6, Math.floor(Number(keep?.level) || 1))),
      population: Math.max(0, Math.floor(Number(game.population) || 0)),
      buildingCount: buildings.length,
      army: Object.values(game.units ?? {}).reduce<number>((total, amount) => total + Math.max(0, Math.floor(Number(amount) || 0)), 0),
    };
  } catch {
    return null;
  }
}

/**
 * AJAN RAPORUNUN İÇERİĞİ — tek karar noktası.
 *
 * Kusur: rapor `projectPublicKingdom` çıktısının tamamıydı ve `resources`
 * alanı karşı krallığın AMBARINI olduğu gibi taşıyordu. Arayüz göstermiyordu
 * ama veri oradaydı (istemciye JSON olarak iniyordu) ve müzakerenin blöf
 * tasarımını doğrudan zayıflatıyordu.
 *
 * Tasarım notu şöyle diyor: "ajan raporu asker sayısını verir ama nöbet oranını
 * ve maaş durumunu vermez — kumar orada." Ambar da aynı tarafta durur: karşı
 * tarafın ne kadar dayanabileceğini bilmek, haraç pazarlığındaki bütün riski
 * ortadan kaldırır.
 *
 * RAPOR VERİR   : hükümdar, arazi, kale seviyesi, nüfus, yapı sayısı, ordu.
 * RAPOR VERMEZ  : ambar, nöbet oranı, asker maaşı, halkın rızası, sadakat,
 *                 hazine, kalan koruma süresi, gece emirleri.
 */
export type IntelReport = Omit<PublicKingdom, "id">;

export function intelReportOf(kingdom: PublicKingdom): IntelReport {
  // Alanlar TEK TEK yazılır: `...kingdom` yayılsaydı `PublicKingdom` ileride
  // büyüdüğünde yeni alan rapora kendiliğinden sızardı — bu kusurun aynısı
  // ambarla bir kez yaşandı.
  return {
    name: kingdom.name,
    ruler: kingdom.ruler,
    terrain: kingdom.terrain,
    keepLevel: kingdom.keepLevel,
    population: kingdom.population,
    buildingCount: kingdom.buildingCount,
    army: kingdom.army,
  };
}

/**
 * Raporun bayatlama eşiği.
 *
 * Keşif KALICIDIR: `discovered` bir kez açıldıktan sonra sönmez ve rapor anlık
 * görüntü olarak donar. Raporun sönmesi bir DENGE kararıdır (keşfin yeniden
 * yapılması gerekir mi?) ve Krala bırakılmıştır; ama raporun YAŞI artık
 * taşınıyor, bu eşiği geçen rapor arayüzde "bayat" işaretlenir. Böylece Kral
 * altı gün önceki bir ordu sayısına taze veri gibi bakmaz.
 */
export const INTEL_REPORT_STALE_MS = 6 * 3_600_000;

export function isStaleReport(takenAt: number, now: number) {
  return now - takenAt >= INTEL_REPORT_STALE_MS;
}
