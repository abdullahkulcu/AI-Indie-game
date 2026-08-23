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
  // bekleyen sayılıyordu. İki sayaç noktası da motor kuralını okumak zorunda.
  const ui = readFileSync(new URL("../components/KingdomGame.tsx", import.meta.url), "utf8");
  // İki sayaç noktası kuralı OLUMSUZ okur (`!isExpired`), durum etiketi ise
  // olumlu okur; ikisini birlikte sayıyoruz.
  const negated = ui.split("!isTimedOut({status:").length - 1;
  const plain = ui.split(":isTimedOut({status:").length - 1;
  assert.ok(negated >= 2, `bekleyen sayaçlarında motor kuralı eksik: ${negated}`);
  assert.ok(plain >= 1, `durum etiketinde motor kuralı okunmuyor: ${plain}`);
  assert.match(ui, /SÜRESİ DOLDU/, "durum etiketinde süresi dolmuş masa karşılığı yok");
});
