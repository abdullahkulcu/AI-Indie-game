/**
 * Başka bir krallığın DIŞARIDAN görünen yüzü.
 *
 * İki ayrı sınır var ve ikisi de burada, TEK yerde çizilir:
 *  1. `PublicKingdom` — aynı channel'daki herkesin görebildiği kaba çerçeve
 *     (harita yerleşimi, ortak maden listesi, müzakere masasındaki isim).
 *  2. `IntelReport`   — BAŞARILI bir ajanın getirdiği rapor; `intel_missions.report`
 *     içinde JSON olarak saklanır ve keşfedilen krallık için arayüze döner.
 */

import { COMPARE_METRICS, COMPARE_MIN_SAMPLE, compareValuesOf, type CompareMetric } from "../engine/comparison";
import { parseStoredSave } from "./save-validation";

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

/**
 * CHANNEL ORTALAMASI — anonim (isimsiz) agregasyon.
 *
 * Kral kendi krallığını channel'daki DİĞER sancakların ortalamasıyla
 * kıyaslayabilir; hangi değerin kime ait olduğu ASLA sızmaz. Bu dosyanın geri
 * kalanındaki disiplin burada da geçerli: dışarıya yalnızca tek tek yazılan
 * alanlar çıkar, ham kayıt hiçbir zaman.
 *
 * TEK KAYNAK NOTU — bu hesap üç işin ortak girdisidir ve üçü de BURADAN
 * beslenir (bkz. `docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md`):
 *  - Fikir 1  — "diyar" sekmesindeki kıyas paneli (bugün uygulanan tüketici).
 *  - Fikir 13 — sessiz kıyaslama: Halk'ın komşularla kendini kıyaslayıp yeni
 *    bir talep açması; kararı gereği saatlik cron turunda, yani bu hesabın
 *    ritmiyle aynı yerde çalışır.
 *  - Fikir 24 — channel-geneli pazar endeksi; kararı gereği bağımsız bir
 *    agregasyon kurmaz, bunu paylaşır.
 * Yeni bir tüketici kendi ortalamasını hesaplamaz; bu fonksiyonu çağırır.
 *
 * Ölçüt listesi, "iyi" yönü ve gizlilik alt sınırı motordadır
 * (`engine/comparison.ts`) — arayüz ve Halk tarafı da aynı tanıma bakar.
 */
export type ChannelAverages = {
  /** Ortalamaya GERÇEKTEN giren sancak sayısı (Kralın kendisi hariç). */
  counted: number;
  /** Kuruluş koruması sürdüğü için hariç tutulan sancak sayısı. */
  protectedOut: number;
  /**
   * Ortalamalar; aday sayısı `COMPARE_MIN_SAMPLE` altındaysa `null` olur.
   * Sayı o durumda istemciye HİÇ inmez — sınır burada, veri katmanında çizilir.
   */
  averages: Record<CompareMetric, number> | null;
};

export function channelAverages(input: {
  /** Kaydın hangi channel'a ait olduğu doğrulanır; `projectPublicKingdom` ile aynı süzgeç. */
  channelName: string;
  /** Kralın kendisi: kendisiyle kıyaslamak anlamsız olduğu için ortalamaya girmez. */
  excludeUserId: string | null;
  /** `GET /api/world`'ün ZATEN okuduğu satırlar; bu hesap için ikinci bir DB turu açılmaz. */
  rows: ReadonlyArray<{ userId: string; gameState: string }>;
  now: number;
}): ChannelAverages {
  const totals: Record<CompareMetric, number> = { popularity: 0, foodRation: 0, taxRate: 0, factionPressure: 0 };
  let counted = 0, protectedOut = 0;
  for (const row of input.rows) {
    // Kralın kendisi İLK elenir: kendi koruma durumu "hariç tutulan komşu"
    // sayısına yazılmamalı, o sayı Krala komşular hakkında bilgi verir.
    if (input.excludeUserId && row.userId === input.excludeUserId) continue;
    /**
     * Kayıt ŞEMANIN KENDİSİYLE okunur (`parseStoredSave`). Gerekçe:
     * `projectPublicKingdom` ham JSON okur, çünkü oradaki amaç eski/kısmi bir
     * kaydı bile haritada göstermek — alan eksikse yerine varsayılan konur.
     * Burada amaç TERSİ: şüpheli bir kayıt ortalamayı SESSİZCE bozmasın. Şema
     * alan sınırlarını (vergi 0-50, rıza 0-100) da tek yerde uyguladığı için
     * elle `Number(...) || 0` zorlamasına gerek kalmaz.
     */
    const save = parseStoredSave(row.gameState);
    if (!save || save.channel !== input.channelName) continue;
    // Kuruluş koruması süren krallık ortalamaya GİRMEZ — dış kese ve göç
    // sistemlerindeki aynı kural: henüz gerçek rekabetin içinde değil.
    if (save.protectionEndsAt > input.now) { protectedOut++; continue; }
    // Hangi ölçüt hangi alandan okunur (ve alan eksikse varsayılanı ne olur)
    // motorda kararlaşır; arayüz "bizdeki değer" satırını AYNI fonksiyondan
    // okur, yoksa iki taraf farklı ölçek gösterirdi.
    const values = compareValuesOf(save);
    for (const metric of COMPARE_METRICS) totals[metric] += values[metric];
    counted++;
  }
  if (counted < COMPARE_MIN_SAMPLE) return { counted, protectedOut, averages: null };
  // Yuvarlama arayüzün işi: hesap tam kalır ki sayıyı doğrudan kullanacak
  // tüketiciler (Fikir 24'ün pazar endeksi) yuvarlama hatası devralmasın.
  const averages = { ...totals };
  for (const metric of COMPARE_METRICS) averages[metric] = totals[metric] / counted;
  return { counted, protectedOut, averages };
}
