/**
 * CHANNEL KIYASLAMASININ SÖZLÜĞÜ — hangi ölçütler kıyaslanır, her ölçütte
 * "iyi" hangi yöndedir ve ortalamanın açıklanabilmesi için en az kaç sancak
 * gerekir.
 *
 * Burası yalnızca KURAL tutar: hesabın kendisi (kayıtları okuyup ortalama
 * almak) sunucudadır, bkz. `server/world-projection.ts` → `channelAverages`.
 * Sözlük motorda yaşar çünkü iki taraf da aynı tanıma bakmak zorunda:
 *  - arayüz (`components/KingdomGame.tsx`) hangi satırı yeşile hangisini
 *    kırmızıya boyayacağını buradan öğrenir — satır başına elle "yüksek vergi
 *    kötüdür" yazılsaydı ölçüt eklendiğinde bir yerde unutulurdu;
 *  - Halk tarafındaki sessiz kıyaslama (plan belgesindeki Fikir 13) aynı yön
 *    tanımına bakar: "komşu sancakta halk daha rahat" cümlesi ölçütün yönü
 *    olmadan kurulamaz.
 */

import { factionPressureOf } from "./faction";
import { rationsOf } from "./populace";

/** Kıyasa giren dört ölçüt. Sıra arayüzdeki satır sırasıdır. */
export const COMPARE_METRICS = ["popularity", "foodRation", "taxRate", "factionPressure"] as const;

export type CompareMetric = typeof COMPARE_METRICS[number];

/**
 * Her ölçütte "iyi" YÖN — TEK KAYNAK.
 *
 * Yüksek rıza ve yüksek istihkak iyidir; yüksek vergi ve yüksek muhalefet
 * baskısı KÖTÜDÜR. Yönler ölçütten ölçüte değiştiği için tek bir "büyük olan
 * iyidir" varsayımı burada yanlış sonuç üretir.
 */
export const COMPARE_BETTER: Record<CompareMetric, "high" | "low"> = {
  popularity: "high",
  foodRation: "high",
  taxRate: "low",
  factionPressure: "low",
};

/**
 * Bir krallığın kıyas değerleri — hangi ölçütün hangi alandan okunduğunun TEK
 * yeri.
 *
 * Sunucu bunu kayıtlar üzerinde ortalama almak için (`channelAverages`), arayüz
 * ise "bizdeki değer" satırı için çağırır. İki taraf ayrı yazsaydı "istihkak
 * kayıtta yoksa varsayılan kaçtır" sorusu iki yerde ayrı cevaplanır ve ortalama
 * bizim satırımızla aynı ölçeği kaybederdi. Varsayılanlar da burada değil,
 * alanın kendi motor okuyucusundadır (`rationsOf`, `factionPressureOf`).
 */
export function compareValuesOf(game: {
  popularity: number;
  taxRate: number;
  foodRation?: number;
  factionPressure?: number;
}): Record<CompareMetric, number> {
  return {
    popularity: game.popularity,
    foodRation: rationsOf({ foodRation: game.foodRation }).food,
    taxRate: game.taxRate,
    factionPressure: factionPressureOf(game),
  };
}

export type CompareVerdict = "better" | "worse" | "even";

/**
 * Bizdeki değer channel ortalamasından iyi mi, kötü mü?
 *
 * Arayüz buraya GÖSTERDİĞİ (yuvarlanmış) sayıları geçer: ekranda aynı görünen
 * iki sayının biri yeşil biri kırmızı olmasın diye kıyas, gösterilen değerler
 * üzerinden yapılır.
 */
export function compareVerdict(metric: CompareMetric, mine: number, average: number): CompareVerdict {
  if (mine === average) return "even";
  return (mine > average) === (COMPARE_BETTER[metric] === "high") ? "better" : "worse";
}

/**
 * GİZLİLİK ALT SINIRI: ortalama en az bu kadar sancaktan hesaplanır.
 *
 * Ortalama isimsizdir ama az sayıda krallığın olduğu bir channel'da anonimlik
 * kâğıt üstünde kalır: iki sancağın ortalaması, kendi değerini bilen bir Kral
 * için rakibin değerini birebir çözer (tek sancakta ise ortalama doğrudan
 * rakibin verisidir). Channel büyüdükçe bu sızıntı kendiliğinden seyreldiği
 * için tek ihtiyaç bir alt sınır: aday sayısı bunun altındaysa sunucu SAYI
 * ÜRETMEZ (bkz. `channelAverages`), arayüz de "kıyas için yeterli sancak yok"
 * der.
 */
export const COMPARE_MIN_SAMPLE = 3;
