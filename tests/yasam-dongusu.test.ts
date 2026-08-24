import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DORMANT_DAYS, PURGE_BATCH, dormantCutoff, seasonClosedNotice } from "../server/lifecycle";

/**
 * HESAP VE SEZON YAŞAM DÖNGÜSÜ.
 *
 * Buradaki iddialar veritabanına DOKUNMAZ (o taraf gerçek Postgres üstünde
 * ölçüldü, bkz. `updates/2026-08-24-sezon-kapanisi-ve-uyuyan-hesap.md`).
 * Bu dosya, gözden kaçması en pahalıya gelen KURALLARI koruyor: silmenin
 * hangi damgaya baktığı ve hangi emniyetleri taşıdığı.
 */

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;

test("uykuda eşiği bir aydır ve sınır o güne tam oturur", () => {
  assert.equal(DORMANT_DAYS, 30);
  assert.equal(dormantCutoff(T0).getTime(), T0 - 30 * DAY);
});

test("tur başına silme sayısı sınırlı: hatalı bir eşik tabloyu bir seferde götürmesin", () => {
  assert.ok(PURGE_BATCH > 0 && PURGE_BATCH <= 1000, `makul bir sınır olmalı, okunan: ${PURGE_BATCH}`);
});

/**
 * BU TESTİN KORUDUĞU ŞEY BİR HATAYI ÖNLÜYOR, ÜSLUP DEĞİL.
 *
 * Oturum çerezi 30 gün yaşıyor (`server/account-auth.ts`), yani her gün oynayan
 * bir Kral bir daha hiç giriş yapmadan bir ay geçirebilir. Silme ölçütü
 * `last_login_at` olsaydı o Kralın hesabı AKTİF OYNARKEN silinirdi. Ölçüt bu
 * yüzden "son görülme": girişle kaydın son yazılmasının EN YENİSİ.
 * `game_saves.updated_at` oynarken 5 saniyede bir ilerliyor.
 */
test("silme ölçütü yalnızca son GİRİŞ değil, kaydın son yazılmasını da sayar", () => {
  const source = readFileSync(new URL("../server/lifecycle-desk.ts", import.meta.url), "utf8");
  assert.match(source, /greatest\(/, "en yeni damga seçilmeli");
  assert.match(source, /lastLoginAt/, "giriş damgası okunmalı");
  assert.match(source, /gameSaves\.updatedAt/, "kaydın yazma damgası da okunmalı");
});

test("silme emniyetleri kodda duruyor: admin, channel sahibi, sahipsiz kayıt", () => {
  const source = readFileSync(new URL("../server/lifecycle-desk.ts", import.meta.url), "utf8");
  assert.match(source, /ne\(users\.role, "admin"\)/, "admin asla silinmemeli");
  assert.match(source, /not exists \(select 1 from channels/, "channel oluşturmuş hesap korunmalı");
  assert.match(source, /not exists \(select 1 from populace_credentials/, "Halk-AI kimliği sahibi korunmalı");
  // `game_saves`in users'a yabancı anahtarı YOK; cascade onu temizlemez.
  assert.match(source, /delete\(gameSaves\)/, "kayıt elle silinmeli, yoksa sahipsiz kalır");
  assert.match(source, /db\.transaction/, "kayıt ve hesap aynı işlemde silinmeli");
});

test("silme raporu sayı verir, kimlik vermez (sır ve kişisel veri sızmaz)", () => {
  const source = readFileSync(new URL("../server/lifecycle-desk.ts", import.meta.url), "utf8");
  for (const forbidden of ["users.email", "displayName", "email"]) {
    assert.ok(!source.includes(forbidden), `${forbidden} rapora girmemeli`);
  }
  assert.ok(!source.includes("console.log"), "silme loglanmamalı");
});

test("sezon kapanış satırı sezonun adını söyler ve dondurulduğunu açıkça yazar", () => {
  const text = seasonClosedNotice("Hızlı Taç");
  assert.match(text, /Hızlı Taç/);
  assert.match(text, /kapandı/);
  assert.match(text, /dondur/, "Kral krallığının neden ilerlemediğini anlamalı");
});

test("sezon kapanışı kaydı SİLMEZ; yalnızca üyeliği ve channel'ı pasife alır", () => {
  const source = readFileSync(new URL("../server/lifecycle-desk.ts", import.meta.url), "utf8");
  const closing = source.slice(source.indexOf("export async function closeEndedChannels"),
    source.indexOf("export async function purgeDormantAccounts"));
  assert.ok(!/delete\(/.test(closing), "kapanış hiçbir şey silmemeli");
  assert.match(closing, /status: "inactive"/, "channel ve üyelik pasife alınmalı");
  assert.match(closing, /db\.transaction/, "yarım kapanmış sezon olmamalı");
});

test("donmuş kayıt 409 DEĞİL 423 döner: istemci sonsuz döngüye girmesin", () => {
  // 409 istemciye "kopyan eski, sunucudakini al ve devam et" demek ve istemci
  // tam olarak bunu yapıyor; donmuş kayıtta bu sonsuz bir döngü olurdu.
  const source = readFileSync(new URL("../app/api/save/route.ts", import.meta.url), "utf8");
  const gate = source.slice(source.indexOf("DONMUŞ KAYIT"), source.indexOf("İstemci hangi sürümün"));
  assert.match(gate, /status: 423/, "donmuş kayıt 423 dönmeli");
  assert.match(gate, /frozen: true/, "arayüz sebebi gösterebilsin");
  assert.ok(!/status: 409/.test(gate), "409 olmamalı");
  // Kuruluş anındaki ilk kayıt bu kapıya takılmamalı.
  assert.match(gate, /if \(existing && !channel\)/, "ilk kayıt muaf olmalı");
});

test("cron sırası: sezon kapanışı EN BAŞTA, hesap silme EN SONDA", () => {
  const source = readFileSync(new URL("../app/api/cron/route.ts", import.meta.url), "utf8");
  const closing = source.indexOf("await closeEndedChannels(now)");
  const orders = source.indexOf("select({ order: standingOrders })");
  const purge = source.indexOf("await purgeDormantAccounts(now)");
  const response = source.indexOf("return Response.json({\n    ranAt:");
  assert.ok(closing > 0 && orders > 0 && purge > 0 && response > 0, "üç çağrı da bulunmalı");
  assert.ok(closing < orders, "kapanış, gece emri sorgusundan ÖNCE olmalı");
  assert.ok(purge > orders, "silme bütün turlardan SONRA olmalı");
  assert.ok(purge < response, "silme cevaptan önce olmalı");
});
