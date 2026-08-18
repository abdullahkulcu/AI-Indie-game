import assert from "node:assert/strict";
import test from "node:test";
import { guardFires, isExplicitOrder } from "../server/general-intent";

// Kural artık burada kopyalanmıyor: route.ts ile testler AYNI modülü kullanır.
// Eskiden kopyaydı ve sessizce ayrıştı — "sat" fiili gerçek kapıda hiç yoktu,
// yani Pazar aracı var olduğu halde Kral onu asla tetikleyemiyordu.

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

test("satış emri araçları açar", () => {
  // Bu satır bir kez kırıldı: "sat" fiili kapıda yoktu, General konuşup
  // hiçbir şey yapmıyordu ve Kral yalnızca "hiçbir şey değişmedi" diyordu.
  assert.equal(isExplicitOrder("Pazarda 100 yiyecek sat."), true);
  assert.equal(isExplicitOrder("sat"), true);
  assert.equal(isExplicitOrder("Biraları satabilirsin"), true);
  assert.equal(isExplicitOrder("odun sat altın al"), true);
  assert.equal(isExplicitOrder("200 taşı nakde çevir"), true);
});

test("her aracın tetikleyici bir fiili vardır", () => {
  const orders = [
    "Taş Ocağı kur.", "5 mızrakçı eğit.", "Göçmen çağır.", "Şenlik düzenle.",
    "Vergiyi %20 yap.", "İnşaatı hızlandır.", "Doktrini belirle.",
    "Yiyecek istihkakını %100 yap.", "Bira istihkakını artır.", "Asker maaşını yükselt.",
    "Nöbet oranını %60 ayarla.", "Gece emri ver.", "Madene 10 işçi gönder.",
    "İşçileri geri çek.", "Ajan gönder.", "Karşı-istihbarat kur.", "Pazarda odun sat.",
  ];
  const missed = orders.filter(order => !isExplicitOrder(order));
  assert.deepEqual(missed, [], `bu emirler araçları açmıyor: ${missed.join(" | ")}`);
});

test("soru ve varsayım hâlâ emir değildir", () => {
  assert.equal(isExplicitOrder("Bira satılır mı sence"), false);
  assert.equal(isExplicitOrder("Satsam ne olur"), false);
  assert.equal(isExplicitOrder("nüfusun geriye kalanı nerde"), false);
});

test("araç çalışmadan satış iddiası guard'ı tetikler", () => {
  assert.equal(guardFires("Pazarda 100 yiyecek sat.", "100 yiyeceği pazarda satıyorum.", 0), true);
  assert.equal(guardFires("Pazarda 100 yiyecek sat.", "100 yiyeceği pazarda satıyorum.", 1), false);
});
