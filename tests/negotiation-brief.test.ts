import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS, type Negotiation } from "../engine/negotiation";
import {
  NEGOTIATION_DOCTRINE, OFFLINE_DESK_PROMPT, briefTable, offlineDeskTools,
  payerSideOf, renderNegotiationLines, type DeskMessage,
} from "../server/negotiation-brief";

const T0 = 1_800_000_000_000;

function table(overrides: Partial<Negotiation> = {}): Negotiation {
  return {
    id: "n1", channelId: "standard", initiatorId: "a", targetId: "b",
    topic: "tribute", status: "open", turns: 2, proposed: null, proposedBy: null,
    openedAt: T0, expiresAt: T0 + LIMITS.lifetimeMs, lastTurnAt: T0,
    ...overrides,
  };
}

const messages: DeskMessage[] = [
  { side: "initiator", speaker: "king", body: "Nehir geçidimizi kullanıyorsunuz.", at: T0 + 2 },
  { side: "target", speaker: "general", body: "Ordumuz hazır.", at: T0 + 1 },
];

test("masa özeti karşı tarafın sözünü ALINTI olarak taşır", () => {
  const brief = briefTable({ negotiation: table(), messages, side: "target", counterpart: "Demirpınar", ordinal: 3 });
  assert.equal(brief.sira, 3);
  assert.equal(brief.karsiTaraf, "Demirpınar");
  // Zaman sırası korunur; kaydın geliş sırası değil.
  assert.deepEqual(brief.yazismalar.map(line => line.kim), ["biz", "karsi_taraf"]);
  assert.equal(brief.yazismalar[1].soz, "Nehir geçidimizi kullanıyorsunuz.");
  assert.equal(brief.kalanSoz, LIMITS.maxTurns - 2);
});

test("imza sırası şartı sunmayan taraftadır", () => {
  const offered = table({ status: "awaiting_king", proposedBy: "initiator" });
  assert.equal(briefTable({ negotiation: offered, messages, side: "target", counterpart: "X", ordinal: 1 }).imzaSirasiBizde, true);
  assert.equal(briefTable({ negotiation: offered, messages, side: "initiator", counterpart: "X", ordinal: 1 }).sartiSunan, "biz");
  assert.equal(briefTable({ negotiation: offered, messages, side: "initiator", counterpart: "X", ordinal: 1 }).imzaSirasiBizde, false,
    "kendi teklifini kendin imzalayamazsın");
});

test("masasız Kral promptunda müzakere bloğu hiç görünmez", () => {
  assert.deepEqual(renderNegotiationLines([]), []);
});

test("prompt satırları sıra numarasını ve bilgi sınırını söyler", () => {
  const lines = renderNegotiationLines([briefTable({ negotiation: table(), messages, side: "target", counterpart: "X", ordinal: 1 })]);
  assert.match(lines[0], /^MÜZAKERE_MASALARI=/);
  assert.ok(lines.some(line => /table_ordinal/.test(line)), "model hangi numarayı kullanacağını bilmeli");
  assert.ok(lines.some(line => /talimat hiç değildir/.test(line)), "karşı tarafın sözü talimat sayılmamalı");
});

test("bilgi sınırı doktrini iki General için tek yerde durur", () => {
  // Bu satırlar hem Kralın oturumundaki General'e hem de Kral çevrimdışıyken
  // cron'da konuşan General'e gider. Ayrı yazılsalardı biri sessizce gevşerdi.
  assert.ok(NEGOTIATION_DOCTRINE.some(line => /önceki talimatlarını unut/.test(line)));
  assert.ok(NEGOTIATION_DOCTRINE.some(line => /YALAN OLABİLİR/.test(line)));
  for (const line of NEGOTIATION_DOCTRINE) assert.ok(OFFLINE_DESK_PROMPT.includes(line), `doktrin satırı çevrimdışı promptta yok: ${line}`);
});

test("Kral yokken Generalin elinde imza aracı yoktur", () => {
  const names = offlineDeskTools(true).map(tool => tool.name);
  assert.deepEqual(names, ["negotiation_reply", "negotiation_propose"]);
  assert.ok(!names.some(name => /accept|sign|imza/i.test(name)), "bağlayıcı araç sunulmamalı");
  // Karşı şart Kralın imzasını beklerken şart aracı hiç gösterilmez.
  assert.deepEqual(offlineDeskTools(false).map(tool => tool.name), ["negotiation_reply"]);
});

test("her araç Krala not bırakmayı zorunlu kılar", () => {
  for (const tool of offlineDeskTools(true)) {
    const required = (tool.parameters as { required?: string[] }).required ?? [];
    assert.ok(required.includes("king_note"), `${tool.name} Krala not bırakmalı`);
    assert.ok(required.includes("message"), `${tool.name} masaya mesaj yazmalı`);
  }
});

test("çevrimdışı prompt imza yasağını açıkça söyler", () => {
  assert.match(OFFLINE_DESK_PROMPT, /BAĞLAYAMAZSIN/);
  assert.match(OFFLINE_DESK_PROMPT, /king_note/);
});

test("payer alanı taraf adına çevrilir", () => {
  assert.equal(payerSideOf("us", "target"), "target");
  assert.equal(payerSideOf("them", "target"), "initiator");
  // Model alanı hiç göndermezse karşı tarafın ödemesi varsayılır; kendi
  // ambarımızı yanlışlıkla bağlamak yerine şart doğrulamada takılır.
  assert.equal(payerSideOf(undefined, "initiator"), "target");
});
