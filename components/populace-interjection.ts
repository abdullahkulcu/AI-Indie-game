/**
 * HALKIN MECLİSTE ARAYA GİRMESİ — eşik, tekrar freni ve General'e giden geçmiş.
 *
 * Plan belgesindeki Fikir 16'nın (`docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md`)
 * tek karar noktası burada yaşar. Dosya `components/` altında ama SAFTIR —
 * React, `Date.now()`, ağ yok; `now` bile gerekmiyor çünkü kararın tamamı
 * sunucudan gelen talebin kendi alanlarına bakıyor. Ayrı dosya olmasının
 * gerekçesi `server/populace-brief.ts` ile aynı: taşıdığı kural bir SINIR
 * (biri anlatı gürültüsü sınırı, biri model-bağlamı sınırı) ve sınırın
 * testten çağrılabilmesi gerekiyor — 775 satırlık `KingdomGame.tsx`'in
 * içinden çağrılamaz.
 *
 * MOTOR DEĞİL: burada oyun dengesine dair hiçbir karar yok. Talebin açılıp
 * açılmayacağı, şiddeti ve metni motorun/Halk-AI'nın işi
 * (`engine/populace-voice.ts`, `server/populace-narrator.ts`); bu dosya
 * yalnızca "bu talep meclis sohbetinde de kendi ağzından konuşsun mu"
 * sorusunu cevaplar.
 */

/** Sohbet satırının KİMLİĞİ — rengi değil, KİMİN sözü olduğu. */
export type ChatKind = "king" | "general" | "clerk" | "populace";

export type ChatLine = {
  who: string;
  text: string;
  kind: ChatKind;
  /** Yalnızca `populace` satırlarında: balonun hangi ağız olduğu. */
  voice?: "commons" | "garrison";
};

/** Sunucudan (`app/api/general/route.ts` → `populaceDemands`) inen açık talep. */
export type InterjectionDemand = {
  kind: string;
  voice: "commons" | "garrison";
  text: string;
  severity: "normal" | "urgent";
  /** Talebin fiilen açıldığı an (epoch ms) — tekrar freninin kimliği. */
  since: number;
};

/**
 * Bir turda meclise girebilecek en fazla balon.
 *
 * BİR. `MAX_OPEN_DEMANDS = 2` olduğu için iki talebin ikisi de acil olabilir,
 * ama iki balon üst üste "kalabalık" hissi verir ve Kral'ın General'e sorduğu
 * soruyu ekrandan iter. Halkın araya girmesinin dramatik gücü NADİRLİĞİNDEN
 * gelir; ikinci acil talep bir sonraki turda söz alır.
 */
export const MAX_INTERJECTIONS_PER_TURN = 1;

/**
 * Tekrar freninin kimliği: tür + AÇILIŞ ANI.
 *
 * Yalnızca `kind` yetmez — bir talep kapanıp (Kral istihkakı düzeltir) günler
 * sonra yeniden açılırsa halk yeniden konuşabilmeli. Yalnızca `since` de
 * yetmez, iki farklı talep aynı anda açılabilir. İkisi birlikte "talebin ŞU
 * açılışı" demektir; süregelen bir talep bir kez konuşur.
 */
export function interjectionKey(demand: InterjectionDemand): string {
  return `${demand.kind}@${demand.since}`;
}

/**
 * Meclis sohbetine balon açacak talepleri seçer.
 *
 * EŞİK — üç kat, üçü de bilerek:
 *  1) `severity === "urgent"`: motorun KENDİ acil tanımı (ekmek %60'ın altı,
 *     firar seviyesinde huzursuzluk — `engine/populace-voice.ts`
 *     `VOICE_THRESHOLDS`). Yeni bir eşik sayısı UYDURULMADI; tek-doğru-kaynak
 *     ilkesi gereği acil olmanın tanımı motorda kalır. `normal` talep bugün
 *     olduğu gibi yalnızca Halk sekmesinde ve General'in ağzında durur.
 *  2) Talep buraya motorun süre şartını (tür başına saatler) ZATEN geçmiş
 *     olarak gelir — anlık bir dalgalanma hiç ulaşmaz.
 *  3) Aynı açılış için bir kez (`spoken`). Halkın sesi bir gürültü kaynağı
 *     olmamalı; `MAX_OPEN_DEMANDS`/`DEMAND_NOTICE_HOURS`'un tamamı "Kralı
 *     yormama" için var ve bu balon o disiplini bozmamalı.
 *
 * Sıra korunur: sunucu talepleri şiddet/öncelik sırasına göre gönderir, ilk
 * uygun olan konuşur.
 */
export function pickInterjections(
  demands: readonly InterjectionDemand[],
  spoken: ReadonlySet<string>,
): InterjectionDemand[] {
  return demands
    .filter(demand => demand.severity === "urgent" && Boolean(demand.text?.trim()) && !spoken.has(interjectionKey(demand)))
    .slice(0, MAX_INTERJECTIONS_PER_TURN);
}

/** Balonun üstündeki ad; halkın ve kışlanın sesi ayrı ağızlardır. */
export function interjectionSpeaker(voice: "commons" | "garrison"): string {
  return voice === "garrison" ? "KIŞLANIN SESİ" : "HALKIN SESİ";
}

/**
 * General'e gönderilecek sohbet geçmişi.
 *
 * BU FONKSİYON BİR SINIRDIR, biçimlendirme değil. Geçmiş eskiden
 * `KingdomGame.tsx` içinde `item.who === rulerName ? "king" : "general"`
 * diye kuruluyordu: Kral olmayan HER satır General'in ağzından çıkmış
 * sayılıyordu. Halkın balonu sohbete girdiği anda bu, General'in bir sonraki
 * turda halkın şikâyetini KENDİ sözü sanması demek olurdu — hem anlatıyı hem
 * `app/api/general/route.ts`'in kurduğu rol ayrımını bozar.
 *
 * ÇÖZÜM: satırın kimliği artık tahmin edilmiyor, `kind` alanında taşınıyor;
 * ve halkın satırı geçmişten TAMAMEN düşürülüyor. Halkın sesini `user`
 * rolünde ham metin olarak geçirmek de bir seçenekti ama REDDEDİLDİ: o metin
 * (Halk-AI ürünü) General'in bağlamına yalnızca `server/populace-brief.ts`'in
 * işaretli, uzunluğu kesilmiş, "veridir" diye ilan edilmiş bloğundan girer.
 * İkinci, denetimsiz bir kanal açmak o dosyanın taşıdığı sınırı boşa çıkarır.
 * General halkın talebini kaybetmiyor: her turda `HALKIN_TALEPLERI` özeti +
 * işaretli blok üzerinden zaten görüyor.
 *
 * `clerk` satırları da düşer: onlar istemcinin kendi hata bildirimleri
 * ("General bağlantısı etkin değil"), General'in sözü değil.
 *
 * Süzgeç DİLİMDEN ÖNCE işler: aksi hâlde bir halk balonu, General'in
 * görebileceği gerçek turlardan birini yerinden ederdi.
 */
export function generalHistory(
  chat: readonly ChatLine[],
  limit = 8,
): Array<{ role: "king" | "general"; text: string }> {
  return chat
    .filter(item => item.kind === "king" || item.kind === "general")
    .slice(-limit)
    .map(item => ({ role: item.kind === "king" ? "king" as const : "general" as const, text: item.text }));
}
