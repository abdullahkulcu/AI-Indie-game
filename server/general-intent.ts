/**
 * Kralın cümlesi emir mi, sohbet mi?
 *
 * Bu kapı gerçekten önemlidir: emir sayılmazsa araçlar modele HİÇ
 * gönderilmez, General konuşur ama hiçbir şey yapmaz — ve bunu Kral yalnızca
 * "hiçbir şey değişmedi" diye fark eder. Kural bu yüzden route.ts içinde
 * gömülü kalmamalı; testler bu dosyayı import eder, kendi kopyasını kurmaz.
 */

/** Sonucu bildiren fiiller. Araç çalışmadan bunlar kullanılırsa guard devreye girer. */
export const CLAIM_PATTERN =
  /\b(başlattım|başlatıyorum|uyguladım|uyguluyorum|emrettim|kurdum|kuruyorum|yükselttim|yükseltiyorum|eğittim|eğitiyorum|ayarladım|düzenledim|hızlandırdım|tamamladım|sattım|satıyorum|aldım|alıyorum|gönderdim|gönderiyorum|çağırdım|çağırıyorum)\b/i;

/** Varsayım ve fikir sorma kalıpları: bunlar emir değildir. */
const HYPOTHETICAL = /(dersem|desem|olsaydı|olursa ne|ne yaparsın|sence|mantıklı mı|doğru mu|farz et|varsayalım)/;

/** Kralın kısa onay cevapları. Bir önceki turda önerilen eylemi yetkilendirir. */
const CONFIRMATION_WORD = /^(evet|tamam|tamamdır|olur|onay|onayla|onaylıyorum|onayladım|kabul|peki|hadi|başla|devam)$/;
/** Cümlenin neresinde geçerse geçsin onay sayılan kalıplar. */
const CONFIRMATION_PHRASE = /(onay ver|onaylıyorum|onayladım|kabul ediyorum)/;

/**
 * Emir fiilleri. Yeni bir araç eklendiğinde fiilini buraya eklemek ZORUNLUDUR;
 * aksi halde araç var olur ama Kral onu asla tetikleyemez.
 */
const ORDER_VERBS = new RegExp(
  "(kur|inşa et|yükselt|seviyeye çıkar|çıkar|eğit|asker bas|düzenle|ayarla|düşür|artır|arttır|hızlandır|bitir|harca|başlat|uygula|yap|yapalım"
  + "|gönder|yolla|görevlendir|geri çek|geri çağır|çek|kes|ver|dağıt|belirle|nöbete"
  // Pazar: satmanın yaygın emir/izin biçimleri. Kök olarak "sat" almıyoruz;
  // "satsam", "satılır mı" gibi varsayım cümleleri emre dönüşmesin diye.
  + "|sat|satar|satarsın|satabilirsin|satabilir|satalım|sattır|satsın|satın al|alalım"
  + "|nakde çevir|paraya çevir|elden çıkar"
  // Nüfus: göçmen çağırma
  + "|çağır|çağıralım"
  + ")(\\b|$)",
);

export function isConfirmationReply(message = "") {
  const normalized = message.trim().toLocaleLowerCase("tr-TR").replace(/[.!?,]+$/, "");
  if (CONFIRMATION_PHRASE.test(normalized)) return true;
  // Onay kısa ve tek başına verilir. Aksi halde "ne olur", "iyi olur" gibi
  // sıradan cümleler onay sayılıp Kralın istemediği eylemleri yetkilendirir.
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length <= 3 && CONFIRMATION_WORD.test(words[0] ?? "");
}

/**
 * Araçlar bu tura verilsin mi?
 *
 * Artık anahtar kelimeye bakmıyoruz. Kralın cümlesinin emir mi soru mu
 * olduğunu General'in kendisi anlar; kural sistem talimatında yazılı ve
 * çağırdığı her eylem ayrıca risk incelemesinden ve motorun doğrulamasından
 * geçer. Kelime listesi iki kez sessizce kırıldı: "sat" ve "çağır" fiilleri
 * eksik olduğu için var olan araçlar Kral tarafından hiç tetiklenemedi.
 * Bağlantı testinde (mode: "test") araç gönderilmez.
 */
export function shouldOfferTools(mode: string | undefined) {
  return mode === "chat";
}

/**
 * Cümle emir gibi mi duruyor? ARTIK BİR KAPI DEĞİL, yalnızca kurtarma
 * sezgisidir: General işi yaptığını söyleyip hiçbir araç çağırmadığında
 * uyarı basmak için kullanılır. Yanlış negatifi zararsızdır.
 */
export function isExplicitOrder(message = "") {
  const normalized = message.toLocaleLowerCase("tr-TR");
  if (HYPOTHETICAL.test(normalized)) return false;
  if (isConfirmationReply(normalized)) return true;
  return ORDER_VERBS.test(normalized);
}

/** Araç çalışmadığı halde General işi yapmış gibi konuştu mu? */
export const guardFires = (message: string, reply: string, actionCount: number) =>
  actionCount === 0 && isExplicitOrder(message) && CLAIM_PATTERN.test(reply);
