/**
 * ZAFER SKORU — "asker olmadan savaşı ana anlatıya taşımak" fikrinin ölçütü
 * (bkz. `docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md` → Fikir 3 ve
 * altındaki "Karar (2026-08-22)").
 *
 * Bu dosya skorun TEK KAYNAĞIDIR: hangi girdi kaç puan, hangi girdi neden puan
 * getirmez ve iki sütunun (askersiz / askeri) sınırı burada çizilir. Arayüz
 * kendi hesabını yapmaz, satır etiketlerini de buradan okur — yoksa "sessiz
 * kese kaç puan" sorusu panelde ve sunucuda ayrı ayrı cevaplanırdı.
 *
 * NEDEN İKİ SÜTUN: vizyonun bütün iddiası "asıl mesele savaşmak değil". Tek bir
 * sayı bunu gizler; askersiz üstünlük ile kılıcın katkısı AYRI görünmek zorunda
 * ki Kral hangi doktrinle yükseldiğini okuyabilsin. Bugünün Demirkale'sinde
 * krallıklar birbirine ORDU GÖNDEREMEZ (akınlar doğanın olayıdır, bkz.
 * `engine/raids.ts`); bu yüzden askeri sütun kaçınılmaz olarak SAVUNMA
 * sütunudur ve tasarım gereği küçüktür. Sezon askersiz sütunda kazanılır.
 *
 * SAF: saat, rastgelelik ve veritabanı yok. Kese defteri (`purses`) çağıranın
 * okuduğu `agitations` satırlarından gelir; sıralama ve rütbe sunucudadır
 * (`server/world-projection.ts` → `channelVictoryStanding`).
 *
 * YENİ ALAN AÇILMADI: skor tamamen var olan verilerden türer — `reputation`,
 * `peopleJoined`/`peopleLeft`, `raidsRepelled`/`raidsSuffered` (kayıt) ve
 * `agitations.status` (veritabanı). Save şemasına dokunulmadığı için CLAUDE.md
 * kısıt #3 (şema `.strict()`) devreye girmez.
 *
 * SKOR BİR GÖSTERGEDİR: sezonu bitirmez, kimseyi kazanan ilan etmez. Channel
 * süreye bağlı biter (`channels.durationDays`); otomatik bitiş ayrı bir iştir.
 */

import { STARTING_REPUTATION } from "./founding";
import type { Game } from "./types";

/**
 * PUAN TABLOSU.
 *
 * Ölçekler, aktif bir sezonda üç kalemin de birbirini bastırmaması için
 * seçildi: günde 4 keseye kadar gönderebilen bir Kral iki haftada birkaç yüz
 * puan sessiz üstünlük toplar; iyi yönetilen bir krallığın nüfus defteri ve
 * itibarı onunla aynı büyüklük sırasında kalır; savunma sütunu ise bilinçli
 * olarak daha küçüktür (yukarıdaki "neden iki sütun" notu).
 */
export const VICTORY = {
  /** Sessizce ulaşan kese: sabotajın işe yaradığı ve kimliğin gizli kaldığı hâl. */
  silentPurse: 6,
  /**
   * Yakalanan kese. Ceza küçük tutuldu çünkü ifşanın ASIL bedeli itibar
   * cezasıdır (`caught_agitating` = −10 itibar) ve o zaten aşağıdaki itibar
   * kaleminden geçiyor; burada tekrar tam bedel yazmak aynı olayı iki kez
   * cezalandırırdı.
   */
  exposedPurse: -3,
  /**
   * TEK HEDEF BAŞINA sayılan sessiz kese tavanı.
   *
   * İSTİSMAR FRENİ: bu tavan olmasa en verimli strateji, terk edilmiş (nöbet
   * kurmayan, dolayısıyla asla ifşa etmeyen) tek bir sancağa gün boyu kese
   * yağdırmak olurdu. Tavan mekaniğin kendisini yansıtır: kesenin etkisi
   * tavanlı ve sönümlü olduğu için (`AGITATION.commons.cap` / `perPurse` ≈ 1,2
   * kese) aynı hedefe üst üste gönderilen kesenin GERÇEK etkisi de doymuş
   * durumda. Doktrin "çok komşuyu zayıflatmayı" ödüllendirir, tek bir ölü
   * sancağı sondalamayı değil.
   */
  purseCapPerTarget: 6,
  /**
   * Karşı-istihbaratımızın yakaladığı GELEN kese. Savunma da askersizdir:
   * nöbeti kurup yabancı eli yakalamak sessiz savaşın kazanılan tarafıdır.
   *
   * İSTİSMAR FRENİ (danışıklı dövüş): iki Kral anlaşıp biri diğerine kese
   * gönderse, yakalayan +4 alır ama gönderen −3 (kese) ve −6 (itibar ×0,6)
   * kaybeder; çift toplamda −5 puan ve 600 altın kaybeder. Danışıklı ifşa
   * KÂRLI DEĞİLDİR (bkz. tests/victory.test.ts).
   */
  caughtPurse: 4,
  /**
   * Nüfus defterinin NET bakiyesi, kişi başına.
   *
   * İSTİSMAR FRENİ: puan `peopleJoined`'a değil NET'e (giren − çıkan) yazılır.
   * Halkını kasten göçe zorlayıp sonra geri toplamak (rızayı düşür-yükselt
   * salınımı) defterin iki tarafını eşit büyütür, net sıfırdır — çevrim puan
   * getirmez. Net eksiye de düşebilir: halkını kaybetmek sessiz savaşı
   * KAYBETMEKTİR, nötr değildir.
   *
   * BİLİNEN SINIR: `peopleJoined` yalnızca komşudan çekilen göçmeni değil,
   * doğal büyümeyi ve `call_settlers` kervanını da sayar (bkz.
   * `engine/tick.ts`, `engine/actions.ts`). Gelen göçmenin KAYNAĞI hiçbir yerde
   * saklanmıyor (`migrations` tablosu hedefi kuyruğa alma anında seçmez), yani
   * "komşudan çekilen" pay bugünkü veriyle ayrıştırılamaz. Bu yüzden kalem
   * ölçülü ağırlıkta: doğal büyüme de iyi yönetimdir ama sabotaj kadar
   * puanlanmaz.
   */
  netSettler: .25,
  /**
   * İtibarın kuruluş değerinden (50) SAPMASI, puan başına. Taban 50 olduğu için
   * hiç kimseye "var olduğu için" puan verilmez: sözünde duran Kral yükselir,
   * yakalanan ya da anlaşmasını bozan Kral düşer.
   */
  reputationPerPoint: .6,
  /** Kayıpsız püskürtülen akın. */
  raidRepelled: 3,
  /** Surdan içeri giren akın. */
  raidBreached: -4,
} as const;

/** Bizim GÖNDERDİĞİMİZ, kaderi belli olmuş tek bir kese. */
export type VictoryPurse = {
  /**
   * Hedefin kimliği; yalnızca GRUPLAMA anahtarıdır (hedef başına tavan için).
   * Skorun hiçbir çıktısında görünmez, hiçbir yere yazılmaz.
   */
  target: string;
  /** `pending` keseler HİÇ girmez: kaderi belli olmayan kese puan da ceza da getirmez. */
  status: "settled" | "exposed";
};

export type VictoryInput = {
  /** Bizim gönderdiğimiz keseler. Bize GELEN keseler buraya girmez. */
  purses: ReadonlyArray<VictoryPurse>;
  /** Karşı-istihbaratımızın yakaladığı gelen kese sayısı. */
  caughtPurses: number;
  /** Kaydın skora giren alanları. */
  game: Pick<Game, "reputation" | "peopleJoined" | "peopleLeft" | "raidsRepelled" | "raidsSuffered">;
};

export type VictoryColumn = "quiet" | "martial";

export type VictoryLineId =
  | "silent_purses" | "exposed_purses" | "counter_intel" | "settlers" | "reputation"
  | "raids_repelled" | "raids_breached";

export type VictoryLine = {
  id: VictoryLineId;
  column: VictoryColumn;
  /** Panelde görünen ad. Etiketler de tek kaynakta: arayüz kendi sözlüğünü tutmaz. */
  label: string;
  /** Puanın hangi sayımdan çıktığı (ör. "12 kese"). */
  detail: string;
  points: number;
};

export type VictoryDoctrineId = "silent" | "steel" | "mixed" | "idle";

export type VictoryDoctrine = { id: VictoryDoctrineId; label: string; note: string };

export type VictoryScore = {
  /** Askersiz üstünlük. */
  quiet: number;
  /** Askeri (savunma) katkı. */
  martial: number;
  total: number;
  lines: VictoryLine[];
  doctrine: VictoryDoctrine;
};

/**
 * Puanın tam sayı hâli. `-0` ayıklanır: eksi ağırlıklı bir kalem sıfır sayımla
 * çarpıldığında JavaScript `-0` üretir ve panelde "−0" yazardı.
 */
const whole = (value: number) => {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  return rounded === 0 ? 0 : rounded;
};

/**
 * Hedef başına tavan uygulanmış sessiz kese sayısı ile ifşa olan kese sayısı.
 *
 * Ceza tavansızdır: tavan cezaya da uygulansa, aynı hedefe altıdan fazla kese
 * yollayıp hepsi yakalanan Kral son keselerinin bedelini ödemezdi.
 */
function purseTally(purses: ReadonlyArray<VictoryPurse>) {
  const settledByTarget = new Map<string, number>();
  let exposed = 0;
  for (const purse of purses) {
    if (purse.status === "exposed") { exposed += 1; continue; }
    settledByTarget.set(purse.target, (settledByTarget.get(purse.target) ?? 0) + 1);
  }
  let settled = 0, targets = 0;
  for (const count of settledByTarget.values()) {
    settled += Math.min(VICTORY.purseCapPerTarget, count);
    targets += 1;
  }
  return { settled, exposed, targets };
}

/**
 * Doktrin etiketi: skorun hangi sütundan geldiğinin bir cümlelik okunuşu.
 *
 * Eşik "askersiz sütun, askeri sütunun en az iki katı" — pozitif askeri katkı
 * yokken (ya da eksideyken) askersiz sütunun kendisi pozitifse doktrin sessiz
 * sayılır.
 */
export function victoryDoctrine(quiet: number, martial: number): VictoryDoctrine {
  if (quiet <= 0 && martial <= 0) {
    return { id: "idle", label: "HENÜZ ÖLÇÜLEN BİR ŞEY YOK", note: "Ne sessiz bir hamle ne püskürtülen bir akın var; defter boş." };
  }
  if (quiet >= 2 * Math.max(0, martial)) {
    return { id: "silent", label: "SESSİZ ÜSTÜNLÜK", note: "Kazandığınız yer kışla değil: kese, defter ve itibar. Doktrin tuttu." };
  }
  if (martial > quiet) {
    return { id: "steel", label: "KILIÇ VE SUR", note: "Skor ağırlıkla surdan geliyor. Savunma iyi ama komşuya dokunan bir eliniz yok." };
  }
  return { id: "mixed", label: "İKİ ELLE", note: "Hem sessiz hamle hem savunma var; sütunlar birbirine yakın." };
}

/**
 * SKOR. Her satır ayrı yuvarlanır ve sütun toplamı YUVARLANMIŞ satırlardan
 * çıkar; böylece panelde gösterilen satırlar sütun toplamına birebir toplanır
 * (kıyas panelindeki aynı disiplin, bkz. `engine/comparison.ts`).
 */
export function victoryScore(input: VictoryInput): VictoryScore {
  const tally = purseTally(input.purses);
  const caught = Math.max(0, Math.floor(input.caughtPurses || 0));
  const joined = Math.max(0, Math.floor(input.game.peopleJoined ?? 0));
  const left = Math.max(0, Math.floor(input.game.peopleLeft ?? 0));
  const net = joined - left;
  const reputationDrift = (Number.isFinite(input.game.reputation) ? input.game.reputation : STARTING_REPUTATION) - STARTING_REPUTATION;
  const repelled = Math.max(0, Math.floor(input.game.raidsRepelled ?? 0));
  const breached = Math.max(0, Math.floor(input.game.raidsSuffered ?? 0));

  const lines: VictoryLine[] = [
    {
      id: "silent_purses", column: "quiet", label: "Sessiz kese",
      detail: tally.settled
        ? `${tally.settled} kese · ${tally.targets} sancak (hedef başına en çok ${VICTORY.purseCapPerTarget})`
        : "Komşuya ulaşan kese yok",
      points: whole(tally.settled * VICTORY.silentPurse),
    },
    {
      id: "exposed_purses", column: "quiet", label: "Yakalanan kese",
      detail: tally.exposed ? `${tally.exposed} kese ifşa oldu` : "Hiçbir kesemiz yakalanmadı",
      points: whole(tally.exposed * VICTORY.exposedPurse),
    },
    {
      id: "counter_intel", column: "quiet", label: "Karşı-istihbarat",
      detail: caught ? `${caught} yabancı kese yakalandı` : "Nöbet henüz kimseyi yakalamadı",
      points: whole(caught * VICTORY.caughtPurse),
    },
    {
      id: "settlers", column: "quiet", label: "Nüfus defteri (net)",
      detail: `${net >= 0 ? "+" : "−"}${Math.abs(net)} kişi · ${joined} geldi / ${left} gitti`,
      points: whole(net * VICTORY.netSettler),
    },
    {
      id: "reputation", column: "quiet", label: "İtibar",
      detail: `Kuruluş değerine göre ${reputationDrift >= 0 ? "+" : "−"}${Math.abs(whole(reputationDrift))} puan`,
      points: whole(reputationDrift * VICTORY.reputationPerPoint),
    },
    {
      id: "raids_repelled", column: "martial", label: "Püskürtülen akın",
      detail: repelled ? `${repelled} akın kayıpsız karşılandı` : "Henüz püskürtülen akın yok",
      points: whole(repelled * VICTORY.raidRepelled),
    },
    {
      id: "raids_breached", column: "martial", label: "Yarılan savunma",
      detail: breached ? `${breached} akın surdan içeri girdi` : "Savunma hiç yarılmadı",
      points: whole(breached * VICTORY.raidBreached),
    },
  ];

  const sum = (column: VictoryColumn) =>
    lines.reduce((total, line) => (line.column === column ? total + line.points : total), 0);
  const quiet = sum("quiet"), martial = sum("martial");
  return { quiet, martial, total: quiet + martial, lines, doctrine: victoryDoctrine(quiet, martial) };
}
