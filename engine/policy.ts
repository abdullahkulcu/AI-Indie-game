import { clampRation, moodState, rationsOf, suppression, armySize, RATION_LIMITS } from "./populace";
import type { Game } from "./types";

/**
 * Kralın doğrudan çevirdiği ayarlar: yiyecek istihkakı, bira istihkakı ve vergi.
 *
 * Bunlar politika kararlarıdır, operasyon değil — Kral General'den izin almadan
 * değiştirebilmeli. General uygulamaz ama her değişiklikte görüşünü söyler;
 * yorum deterministiktir, LLM çağrısı gerektirmez ve hiç token harcamaz.
 */

export type PolicyKey = "foodRation" | "aleRation" | "taxRate";

export type PolicyChange = { key: PolicyKey; value: number };

export type PolicyResult = { game: Game; comment: string };

/**
 * Kralın ayarlarının motor sınırları — TEK KAYNAK.
 *
 * Dışa açıktır çünkü sunucu doğrulaması (`server/save-validation.ts`) kayıttaki
 * ayarların motorun kabul ettiği aralıkta olduğunu aynı sayılarla ölçer; ayrı
 * yazıldığında şema motorun reddettiği bir vergiyi kabul ediyordu.
 */
export const POLICY_LIMITS: Record<PolicyKey, { min: number; max: number }> = {
  foodRation: { min: RATION_LIMITS.min, max: RATION_LIMITS.max },
  aleRation: { min: RATION_LIMITS.min, max: RATION_LIMITS.max },
  taxRate: { min: 0, max: 50 },
};

export function clampPolicy(key: PolicyKey, value: number) {
  const limit = POLICY_LIMITS[key];
  const rounded = Math.round(Number(value) || 0);
  return Math.max(limit.min, Math.min(limit.max, rounded));
}

function foodComment(game: Game, next: number, previous: number) {
  if (next < 40) return "Bu istihkakla halk açlıktan kırılır Kralım. Söyleyeceğimi söyledim; sorumluluk sizde.";
  if (next < 70) return "Yarım istihkak halkı hızla soğutur. Birkaç gün idare eder, sonrası öfkedir.";
  if (next > 140) return "Cömert bir sofra. Ambar dayandığı sürece halk sizi sever, ama yiyecek üretimimizi kontrol edin.";
  if (next > previous) return "İstihkakı yükselttiniz; halk bunu fark edecektir.";
  if (next < previous) return "Payı kıstık. Şimdilik taşınır, uzarsa taşınmaz.";
  return "İstihkak aynı kaldı.";
}

function aleComment(game: Game, next: number) {
  const hasBrewery = game.buildings.some(building => building.type === "brewery");
  if (next > 0 && !hasBrewery) return "Bira dağıtmak istiyorsunuz ama Bira Evimiz yok; ambardaki bira bitince bu emir kâğıt üstünde kalır.";
  if (next === 0) return "Bira kesildi. Kimse açlıktan ölmez ama akşamlar uzar.";
  if (next > 120) return "Bolca bira. Moral yükselir, fakat aç bir halk birayla doymaz.";
  return "Bira payı ayarlandı.";
}

function taxComment(game: Game, next: number, previous: number) {
  if (next > 40) return "Bu vergi soygundur Kralım. Halk bunu uzun süre kaldırmaz; isyanı göze alıyorsanız başka.";
  if (next > 30) return "Ağır bir vergi. Hazine dolar, rıza erir; dengeyi yakından izleyeceğim.";
  if (next === 0) return "Vergiyi tamamen kaldırdınız. Halk sevinir, hazine ise kendi kendini toplamaz.";
  if (next > previous) return "Vergiyi yükselttik; kesenin ağzını sıkan her hükümdar biraz sevgi kaybeder.";
  if (next < previous) return "Vergi indi. Halk rahatlar, gelir düşer.";
  return "Vergi oranı aynı kaldı.";
}

/**
 * Politika değişikliğini uygular ve General'in tepkisini döndürür.
 * Halkın o anki durumu yorumu sertleştirebilir.
 */
export function applyPolicy(game: Game, change: PolicyChange): PolicyResult {
  const value = clampPolicy(change.key, change.value);
  const rations = rationsOf(game);
  const previous = change.key === "taxRate" ? game.taxRate : change.key === "foodRation" ? rations.food : rations.ale;

  const next: Game = change.key === "taxRate"
    ? { ...game, taxRate: value }
    : change.key === "foodRation"
      ? { ...game, foodRation: clampRation(value) }
      : { ...game, aleRation: clampRation(value) };

  let comment = change.key === "foodRation" ? foodComment(game, value, previous)
    : change.key === "aleRation" ? aleComment(game, value)
      : taxComment(game, value, previous);

  // Halk zaten kaynıyorsa General uyarısını sertleştirir.
  const mood = moodState(game.popularity, suppression(armySize(game.units ?? {}), game.population, game.soldierUnrest ?? 0));
  if ((mood.id === "strike" || mood.id === "revolt") && (value < previous || change.key === "taxRate")) {
    comment += ` Halk şu an ${mood.label.toLocaleLowerCase("tr-TR")} durumunda; bu kararın zamanlaması kötü.`;
  }

  const label = change.key === "taxRate" ? "Vergi" : change.key === "foodRation" ? "Yiyecek istihkakı" : "Bira istihkakı";
  return {
    game: { ...next, notices: [{ kind: "FERMAN", text: `${label} %${value} olarak belirlendi.`, at: Date.now() }, ...next.notices].slice(0, 20) },
    comment,
  };
}
