/**
 * KRALIN KENDİ ELİYLE CEVAP YAZMASI.
 *
 * Sunucu bunu ZATEN destekliyordu: `/api/negotiate` gövdedeki `speaker`
 * alanını okuyor ve "general" değilse "king" yazıyor. Arayüzde o yolu çağıran
 * hiçbir düğme yoktu — Kral masayı açarken ve şart sunarken kendi cümlesini
 * yazabiliyor ama masa kurulduktan sonra şart taşımayan düz bir cevap
 * yazamıyordu. Her söz Generalin ağzından gidiyordu.
 *
 * Eklenen şey bir kural DEĞİL, bir kanal. Bu yüzden testin işi iki şeyi
 * korumak: (1) kanalın Kral olarak yazdığı, (2) konuşma hakkının motordan
 * okunduğu — panelin kendi eşiğini kurmadığı.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canSpeak, LIMITS, type Negotiation } from "../engine/negotiation";

const T0 = 1_700_000_000_000;
const ui = readFileSync(new URL("../components/KingdomGame.tsx", import.meta.url), "utf8");

function table(overrides: Partial<Negotiation> = {}): Negotiation {
  return {
    id: "n1", channelId: "c1", initiatorId: "u1", targetId: "u2",
    topic: "non_aggression", status: "open", turns: 2,
    proposed: null, proposedBy: null,
    openedAt: T0, expiresAt: T0 + LIMITS.lifetimeMs, lastTurnAt: T0,
    ...overrides,
  } as Negotiation;
}

test("panel Kral olarak yazan bir cevap yolu taşıyor", () => {
  assert.match(ui, /async function kingReply\(/, "Kralın cevap göndericisi yok");
  assert.match(
    ui, /action:"reply",speaker:"king"/,
    'cevap "king" olarak gönderilmiyor; sunucu onu Generalin sözü sayar',
  );
});

test("Generalin araç yolu HÂLÂ General olarak yazıyor", () => {
  // İki kanal ayrı kalmalı: Generalin aracı Kralın ağzından konuşmaya
  // başlarsa masadaki iki ses birbirine karışır.
  assert.match(ui, /action:"reply",speaker:"general"/, "Generalin kendi cevap yolu kaybolmuş");
});

test("söz düğmesi motorun konuşma hakkını okur, kendi eşiğini kurmaz", () => {
  assert.match(ui, /canSpeak\(asNegotiation,table\.side,now\)\.ok/, "panel canSpeak'i okumuyor");
  // Panelde süreyi/tavanı elle karşılaştıran ikinci bir kural olmamalı.
  assert.equal(
    /table\.turns\s*>=\s*\d/.test(ui), false,
    "panelde elle yazılmış bir söz tavanı karşılaştırması var; kural ikiye ayrılmış",
  );
});

test("konuşma hakkı: yaşayan masada var, süresi geçmişte ve tavanda yok", () => {
  const canli = table();
  assert.equal(canSpeak(canli, "target", T0).ok, true);
  // Canlıda doğrulanan iki kapı:
  assert.equal(canSpeak(canli, "target", canli.expiresAt).ok, false, "süresi geçmiş masada söz hakkı kalmamalı");
  assert.equal(canSpeak(table({ turns: LIMITS.maxTurns }), "target", T0).ok, false, "söz tavanı dolmuşsa hak kalmamalı");
});

test("kapanmış masada söz hakkı yok", () => {
  for (const status of ["agreed", "declined"] as const) {
    assert.equal(canSpeak(table({ status }), "target", T0).ok, false, `${status} masasında konuşulabiliyor`);
  }
});

test("kendi şartı karşı tarafın önündeyken Kral yine konuşamaz", () => {
  // Motorun mevcut kuralı; panel onu okuduğu için düğme de çıkmaz.
  const bekleyen = table({ status: "awaiting_king", proposedBy: "target" });
  assert.equal(canSpeak(bekleyen, "target", T0).ok, false);
  assert.equal(canSpeak(bekleyen, "initiator", T0).ok, true, "karşı taraf cevap verebilmeli");
});
