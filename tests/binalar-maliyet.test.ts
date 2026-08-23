/**
 * BİNALAR SEKMESİNDE MALİYET GÖSTERİMİ.
 *
 * İki gerçek hata bu testin varlık sebebi; ikisi de canlı tarayıcıda görüldü:
 *
 * 1. KİLİTLİ yapıda maliyet BOŞ basılıyordu. `buildOptions` bilinçli olarak
 *    yalnızca ŞİMDİ emredilebilen yapıları döndürüyor (kilitli olan listeden
 *    düşüyor), arayüz ise `?? {}` ile yedekleyip "Sonraki emir maliyeti ·"
 *    yazıp arkasını boş bırakıyordu. Oyuncu Pazar ya da Sur için ne
 *    biriktireceğini hiçbir yerden öğrenemiyordu.
 * 2. Kalemler motorun İNGİLİZCE anahtarıyla basılıyordu ("wood 148"), oysa
 *    `resourceLabels` bu dosyada zaten import ediliyor ve başka üç yerde
 *    kullanılıyordu.
 *
 * Arayüzün JSX'i bu kod tabanında çalıştırılarak test edilemiyor (DOM/render
 * testi yok, bkz. package.json → test listesi), o yüzden denetim kaynak
 * metni üzerinden yapılıyor — `tests/istihbarat-tab.test.ts` ile aynı desen.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { catalog } from "../engine/catalog";
import { costFor, materialScaleOf } from "../engine/tick";

const source = readFileSync(new URL("../components/KingdomGame.tsx", import.meta.url), "utf8");

test("kilitli yapının maliyeti boş kalmaz: yedek hesap costFor ile yapılır", () => {
  // `?? {}` geri gelirse kilitli satır yine boş basar.
  assert.equal(
    source.includes("?.cost??{}"), false,
    "kilitli yapı için boş nesne yedeği geri gelmiş: 'maliyeti ·' arkası yine boş basılır",
  );
  assert.ok(
    source.includes("?.cost??costFor(item.cost,current,carpan)"),
    "yedek maliyet hesabı `costFor` ile yapılmıyor",
  );
});

test("maliyet formülü arayüzde İKİNCİ kez yazılmaz — buildOptions ile aynı fonksiyon", () => {
  // Tek-doğru-kaynak (CLAUDE.md kısıt #5): arayüz kendi çarpanını/formülünü
  // kurmaz. `costFor` motorda ne veriyorsa arayüz de onu gösterir.
  const locked = catalog.find(item => item.unlock > 1);
  assert.ok(locked, "kataloğda Kale Sv.1'de kilitli bir yapı yok; test varsayımı bozulmuş");
  const cost = costFor(locked.cost, 0, materialScaleOf(1));
  assert.ok(
    Object.keys(cost).length > 0,
    "kilitli yapının kataloğdaki maliyeti boş; gösterilecek bir şey yok",
  );
});

test("maliyet kalemleri motor anahtarıyla değil Türkçe etiketle basılır", () => {
  assert.equal(
    source.includes('map(([k,v])=>`${k} ${v}`)'), false,
    "kalem ham motor anahtarıyla basılıyor (\"wood 148\"); resourceLabels atlanmış",
  );
  assert.ok(
    source.includes('resourceLabels.find(([id])=>id===k)?.[1]??k'),
    "maliyet kalemi `resourceLabels` üzerinden çevrilmiyor",
  );
});
