/**
 * KADER — General'in rutin taleplerinden ayrı, nadir büyük dönemeçler.
 *
 * Bu modül yalnızca eşik ve ikilemi seçer. Zaman, veritabanı ve model yoktur;
 * aynı krallık durumu aynı Kader anını üretir. Kalıcılık ve "sezonda bir kez"
 * kuralı `server/fate-desk.ts`teki source key ile sağlanır.
 */
import type { Game } from "./types";

export const FATE_KINDS = ["defiant_opposition", "empty_tables", "garrison_breaking"] as const;
export type FateKind = typeof FATE_KINDS[number];

export type FateCue = {
  kind: FateKind;
  title: string;
  text: string;
  discussion: string;
};

const armySize = (game: Game) => Object.values(game.units).reduce((sum, amount) => sum + Math.max(0, Number(amount) || 0), 0);

/** Yalnız en ağır eşik konuşur; aynı turda Kralın önüne üç ikilem yığılmaz. */
export function fateCueOf(game: Game): FateCue | null {
  if ((game.factionPressure ?? 0) >= 80) return {
    kind: "defiant_opposition",
    title: "Meydanın sabrı tükendi",
    text: "Muhalefet artık yalnız homurdanmıyor; her ertelenen karar kalabalığın kendi düzenini kurmasına alan açıyor.",
    discussion: "Meydanın açık meydan okumasına karşı taviz mi verelim, yoksa düzeni korurken güveni geri kazanacak daha yavaş bir yol mu seçelim? Somut seçenekleri ve bedellerini çıkar.",
  };
  if (Number(game.foodRation ?? 100) < 60) return {
    kind: "empty_tables",
    title: "Sofralar boşalıyor",
    text: "İstihkak artık geçici bir tasarruf değil; ailelerin günlük düzenini bozan bir kopuş hâline geldi.",
    discussion: "Azalan istihkak karşısında ambarı korumakla halkı tam doyurmak arasındaki seçenekleri, her birinin süresini ve siyasi bedelini tart.",
  };
  if (armySize(game) > 0 && Number(game.soldierUnrest ?? 0) >= 60) return {
    kind: "garrison_breaking",
    title: "Kışlanın sözü çözülüyor",
    text: "Askerin huzursuzluğu artık bir maaş notu değil; nöbetin ve komuta zincirinin dayanıklılığını belirleyen bir kırılma noktası.",
    discussion: "Kışla huzursuzluğunu çözmek için hangi bedeli önce ödemeliyiz? Maaşı düzeltmenin, nöbeti indirmenin ve büyümeyi ertelemenin sonuçlarını karşılaştır.",
  };
  return null;
}

/** Her channel sezonu için aynı eşik yalnız bir kez doğar. */
export function fateSourceKey(game: Pick<Game, "channelId">, cue: Pick<FateCue, "kind">) {
  return `${game.channelId}:${cue.kind}`;
}
