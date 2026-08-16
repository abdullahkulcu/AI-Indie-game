import assert from "node:assert/strict";
import test from "node:test";

// route.ts Cloudflare'a özgü modülleri import ettiği için guard mantığını burada
// birebir aynı kurallarla yeniden kurup davranışı sabitliyoruz.
const CLAIM_PATTERN = /\b(başlattım|başlatıyorum|uyguladım|uyguluyorum|emrettim|kurdum|kuruyorum|yükselttim|yükseltiyorum|eğittim|eğitiyorum|ayarladım|düzenledim|hızlandırdım|tamamladım)\b/i;

function isExplicitOrder(message = "") {
  const normalized = message.toLocaleLowerCase("tr-TR");
  if (/(dersem|desem|olsaydı|olursa ne|ne yaparsın|sence|mantıklı mı|doğru mu|farz et|varsayalım)/.test(normalized)) return false;
  return /(kur|inşa et|yükselt|seviyeye çıkar|eğit|asker bas|düzenle|ayarla|düşür|artır|hızlandır|bitir|harca|başlat|uygula|hemen yap)(\b|$)/.test(normalized);
}

const guardFires = (message: string, reply: string, actionCount: number) =>
  actionCount === 0 && isExplicitOrder(message) && CLAIM_PATTERN.test(reply);

test("soruya verilen 'devam ediyor' cevabı guard'ı tetiklemez", () => {
  const reply = "Sen çevrimdışıyken üretim ve inşaat kuyruğu devam ediyor; yeni karar alamam.";
  assert.equal(guardFires("Sen arka planda yani ben çevrimdışıyken ne yapıyorsun", reply, 0), false);
});

test("gerçek durum raporu guard'ı tetiklemez", () => {
  assert.equal(guardFires("Kışla ne durumda", "Kışla inşaatı devam ediyor, 40 saniye kaldı.", 0), false);
});

test("emirde araç çalışmadan 'başlattım' demek guard'ı tetikler", () => {
  assert.equal(guardFires("Taş ocağını başlat", "Taş Ocağı inşaatını başlattım.", 0), true);
});

test("araç gerçekten çalıştıysa guard devreye girmez", () => {
  assert.equal(guardFires("Taş ocağını başlat", "Taş Ocağı inşaatını başlattım.", 1), false);
});

test("varsayımsal cümle emir sayılmaz", () => {
  assert.equal(guardFires("Taş ocağını kursak ne olur", "Kursak iyi olurdu, başlatmadım.", 0), false);
});
