/**
 * VERGİYİ KİM ÇEVİRİYOR? — arayüz dört farklı cevap veriyordu.
 *
 * Gerçek davranış: vergiyi ve istihkakları Kral DOĞRUDAN çevirir. HALK
 * sekmesindeki −/+ düğmeleri gerçekten çalışıyor ve `engine/policy.ts`'in
 * `PolicyKey`i bu üç kolu baştan beri "Kralın doğrudan çevirdiği ayarlar"
 * diye tanımlıyor.
 *
 * Buna karşı arayüz üç yerde TERSİNİ söylüyordu:
 *   · DEFTER sekmesinde kaydırıcı kilitli, altında "General'i ikna etmelisin"
 *   · Başlangıç rehberinin IV. adımı "vergiyi düğmeyle değiştirmezsin"
 *   · "Generalin yetkileri" kartı "Vergi ayarla"yı yetki listesine koyuyor —
 *     ve hemen altındaki satırda "Kral doğrudan çevirir" yazıyordu, yani kart
 *     kendi kendiyle çelişiyordu.
 *
 * Bu bir yazım hatası değil, kuralın altı yere elle yazılmasının sonucuydu
 * (CLAUDE.md kısıt #5). Test kuralın TEK kaynakta kaldığını denetler.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { POLICY_AUTHORITY_NOTE, POLICY_LABELS, POLICY_LIMITS, type PolicyKey } from "../engine/policy";

const ui = readFileSync(new URL("../components/KingdomGame.tsx", import.meta.url), "utf8");

test("Kralın kendi çevirdiği kollar motorda tanımlı ve etiketleri var", () => {
  const keys = Object.keys(POLICY_LIMITS) as PolicyKey[];
  assert.deepEqual(keys.sort(), ["aleRation", "foodRation", "taxRate"]);
  for (const key of keys) {
    assert.ok(POLICY_LABELS[key], `${key} için arayüz etiketi yok`);
  }
});

test("yetki cümlesi arayüzde ELLE yazılmıyor, motordan basılıyor", () => {
  assert.match(ui, /\{POLICY_AUTHORITY_NOTE\}/, "arayüz yetki cümlesini motordan okumuyor");
  // Cümlenin elle yazılmış bir kopyası kalmamalı; iki kopya zamanla ayrışır.
  assert.equal(
    ui.includes(POLICY_AUTHORITY_NOTE), false,
    "yetki cümlesinin elle yazılmış bir kopyası arayüzde duruyor",
  );
});

test("arayüz hiçbir yerde 'vergi için General'i ikna et' demiyor", () => {
  // Üç yalanın hepsi bu kalıptandı. Vergiden söz eden bir cümlede "ikna"
  // ya da "değiştirmezsin" geçiyorsa yalan geri gelmiş demektir.
  // JSX'te kesme işareti `&apos;` olarak yazılıyor, yani "General'i" kaynakta
  // "General&apos;i" görünüyor. Desen bunu kaçırırsa test yalanı yakalamaz —
  // mutasyon denemesinde tam bu oldu ve desen genişletildi.
  const yalanlar = [
    /vergi[^.]{0,80}ikna etmelisin/i,
    /vergiyi düğmeyle değiştirmezsin/i,
    /Değiştirmek için General(&apos;|.{0,3})i ikna etmelisin/i,
    /ikna etmelisin/i,
  ];
  for (const kalip of yalanlar) {
    assert.equal(kalip.test(ui), false, `arayüzde eski yanlış anlatım geri gelmiş: ${kalip}`);
  }
});

test("Kralın kolları Generalin YETKİ listesinde görünmüyor", () => {
  // Kart Generalin yapabildiklerini sayar. Kralın kendi çevirdiği bir kol
  // oraya girerse yetki iki tarafa da yazılmış olur.
  const liste = ui.slice(ui.indexOf('className="authority-list"'));
  const blok = liste.slice(0, liste.indexOf("</div>"));
  assert.equal(blok.includes("Vergi ayarla"), false, "'Vergi ayarla' hâlâ Generalin yetkileri arasında");
  for (const label of Object.values(POLICY_LABELS)) {
    assert.equal(blok.includes(label), false, `'${label}' Generalin yetki listesinde duruyor`);
  }
  // Generalin gerçekten yaptığı işler listede kalmalı; liste boşaltılmamış olsun.
  assert.ok(blok.includes("Yapı kur/yükselt"));
  assert.ok(blok.includes("Asker maaşı"), "asker maaşı Generalin işi; listeden düşmemeliydi");
});

test("vergi düğmeleri motorun sınırlarını okuyor", () => {
  // Kolun Kralın elinde olması sınırsız olması demek değil; tavan motorda.
  assert.equal(POLICY_LIMITS.taxRate.min, 0);
  assert.equal(POLICY_LIMITS.taxRate.max, 50);
  assert.match(ui, /clampPolicy\(/, "arayüz motorun kıskacını çağırmıyor");
});
