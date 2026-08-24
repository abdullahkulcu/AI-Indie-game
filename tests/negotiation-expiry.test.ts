/**
 * SÜRESİ DOLAN MÜZAKERE MASASI.
 *
 * Kural bugüne kadar YALNIZCA `canSpeak` içinde yaşıyordu, yani sadece
 * "konuşmayı engelle" tarafı vardı. Masanın DURUMUNU yazan hiçbir yol yoktu ve
 * sonucu görünür bir hataydı: süresi geçmiş masa Kralın defterinde `open`
 * kalıyor, arayüz ona tur sayacı gösteriyor ve "cevap bekleyen masa"
 * sayacında SONSUZA KADAR duruyordu — temizlenmesi imkânsız bir bildirim.
 *
 * Bu test kuralın tek kaynakta olduğunu ve `canSpeak` ile AYNI eşiği
 * kullandığını denetler.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canSpeak, EXPIRABLE_STATUSES, isExpired, isTimedOut, LIMITS,
  type Negotiation, type NegotiationStatus,
} from "../engine/negotiation";

const T0 = 1_700_000_000_000;

function table(overrides: Partial<Negotiation> = {}): Negotiation {
  return {
    id: "n1", channelId: "c1", initiatorId: "u1", targetId: "u2",
    topic: "non_aggression", status: "open", turns: 1,
    proposed: null, proposedBy: null,
    openedAt: T0, expiresAt: T0 + LIMITS.lifetimeMs, lastTurnAt: T0,
    ...overrides,
  } as Negotiation;
}

test("süre dolmadan masa süresi geçmiş sayılmaz", () => {
  const row = table();
  assert.equal(isExpired(row, row.expiresAt - 1), false);
});

test("süre dolduğu AN masa süresi geçmiş sayılır — canSpeak ile aynı eşik", () => {
  const row = table();
  // canSpeak `now >= expiresAt` diyor; isExpired aynı karşılaştırmayı yapmalı,
  // yoksa bir masa "konuşulamaz ama açık" arafında kalır.
  assert.equal(isExpired(row, row.expiresAt), true);
  assert.equal(canSpeak(row, "initiator", row.expiresAt).ok, false);
});

test("imzalanmış ya da reddedilmiş masanın süresi DOLMAZ — o durumlar nihai", () => {
  const gecmis = T0 + LIMITS.lifetimeMs + 1;
  for (const status of ["agreed", "declined"] as const) {
    assert.equal(
      isExpired(table({ status }), gecmis), false,
      `${status} masası süresi geçmiş sayılıyor; imzalı anlaşma yürürlükte kalmalı`,
    );
  }
});

test("şart sunulmuş masanın da süresi dolar", () => {
  assert.equal(isExpired(table({ status: "awaiting_king" }), T0 + LIMITS.lifetimeMs), true);
});

test("süresi dolabilen durumlar listesi nihai durumları İÇERMEZ", () => {
  const list = EXPIRABLE_STATUSES as readonly NegotiationStatus[];
  assert.equal(list.includes("agreed"), false);
  assert.equal(list.includes("declined"), false);
  assert.equal(list.includes("expired"), false, "kapanmış masa yeniden kapatılmaya çalışılmamalı");
  assert.ok(list.includes("open"));
});

test("durumu YAZAN bir yol var: süpürme hem gece vardiyasında hem okuma yolunda", () => {
  // Bu maddenin asıl eksiği "kural yok" değil "yazan yok"tu. İki çağrı yerinin
  // de kalması bu testle korunuyor.
  const desk = readFileSync(new URL("../server/negotiation-desk.ts", import.meta.url), "utf8");
  assert.match(desk, /export async function expireStaleTables/, "süpürme fonksiyonu yok");
  assert.match(desk, /await expireStaleTables\(Date\.now\(\), \{ channelId \}\)/, "okuma yolu süpürmüyor");
  assert.match(desk, /EXPIRABLE_STATUSES/, "süpürme motorun listesini okumuyor; ikinci bir kopya yazılmış");

  const cron = readFileSync(new URL("../app/api/cron/route.ts", import.meta.url), "utf8");
  assert.match(cron, /await expireStaleTables\(now\)/, "gece vardiyası süpürmüyor");
});

test("DAMGALANMIŞ masa da zamanla bitmiş sayılır — geçiş kuralı ile durum sorusu ayrı", () => {
  // Gerçek bir hata: arayüz yalnızca `isExpired`i okuyordu. Süpürme satırı
  // `expired` damgaladıktan SONRA o kural false dönüyor (kapatılacak bir şey
  // kalmadı), dolayısıyla arayüz masaya yine tur sayacı gösteriyordu.
  const damgali = table({ status: "expired" });
  assert.equal(isExpired(damgali, T0 + LIMITS.lifetimeMs + 1), false, "geçiş kuralı damgalıyı yeniden kapatmamalı");
  assert.equal(isTimedOut(damgali, T0), true, "durum sorusu damgalıya 'bitti' demeli");
  // Henüz damgalanmamış ama süresi geçmiş masa için ikisi de 'bitti' der.
  const gecmis = table();
  assert.equal(isTimedOut(gecmis, gecmis.expiresAt), true);
  // Yaşayan masa hiçbirine takılmaz.
  assert.equal(isTimedOut(gecmis, gecmis.expiresAt - 1), false);
  // Nihai durumlar zamanla değil kendi kararıyla kapanır; karıştırılmasın.
  assert.equal(isTimedOut(table({ status: "agreed" }), T0 + LIMITS.lifetimeMs + 1), false);
});

test("arayüz süresi geçmiş masayı 'cevap bekliyor' saymaz", () => {
  // Kalıcı hayalet rozetin kaynağı buydu: agreed/declined dışındaki her masa
  // bekleyen sayılıyordu. Sayaç noktaları motor kuralını okumak zorunda.
  const ui = readFileSync(new URL("../components/KingdomGame.tsx", import.meta.url), "utf8");
  const negated = ui.split("!isTimedOut({status:").length - 1;
  assert.ok(negated >= 2, `bekleyen sayaçlarında motor kuralı eksik: ${negated}`);

  // Durum etiketi TEK bir yardımcıda yaşar (`masaDurumu`) ve o da motor
  // kuralını okur. Etiket zinciri iki yere kopyalanırsa canlı liste ile geçmiş
  // listesi aynı masaya iki farklı şey der.
  const helper = ui.slice(ui.indexOf("function masaDurumu"), ui.indexOf("function masaDurumu") + 900);
  assert.match(helper, /isTimedOut\(\{status:/, "durum etiketi motor kuralını okumuyor");
  assert.equal(ui.split("SÜRESİ DOLDU").length - 1, 1,
    "'SÜRESİ DOLDU' etiketi yalnızca tek yerde yazılmalı");
  assert.equal(ui.split("\"ANLAŞILDI\"").length - 1, 1,
    "'ANLAŞILDI' etiketi yalnızca tek yerde yazılmalı");
});

test("kapanmış masa Kralın önündeki listede DURMAZ, geçmişte durur", () => {
  // Kural motorda tek yerde (`isClosedTable`), listeyi bölen de tek yer
  // (`loadTablesFor`). Uçta iki ayrı liste dönüyor.
  const desk = readFileSync(new URL("../server/negotiation-desk.ts", import.meta.url), "utf8");
  assert.match(desk, /live: desk\.filter\(row => !isClosedTable/, "canlı liste kuralı olumsuz okumalı");
  assert.match(desk, /closed: desk\.filter\(row => isClosedTable/, "geçmiş listesi kuralı olumlu okumalı");
  // General YALNIZCA canlı masaları görür: kapanmış masayı okumak boşa token.
  assert.match(desk, /loadTablesFor\(userId, channelId\)\)\.live/, "brief canlı listeden beslenmeli");

  const route = readFileSync(new URL("../app/api/negotiate/route.ts", import.meta.url), "utf8");
  assert.match(route, /desk\.live\.map\(shape\)/, "panel canlı listeyi almalı");
  assert.match(route, /desk\.closed\.map\(shape\)/, "panel geçmiş listesini de almalı");

  const ui = readFileSync(new URL("../components/KingdomGame.tsx", import.meta.url), "utf8");
  assert.match(ui, /setEnvoyHistory\(data\.history/, "arayüz geçmişi okumalı");
  assert.match(ui, /envoy-history/, "geçmiş bölümü çizilmeli");
});
