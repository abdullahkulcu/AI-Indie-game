import assert from "node:assert/strict";
import test from "node:test";
import { guardNegotiationActions, isNegotiationAction, mentionsNegotiation } from "../server/general-negotiation-guard";

const openTable = { bizimKrallik: "Demirkale", sira: 1, konu: "non_aggression" as const, durum: "open" as const, karsiTaraf: "Akçay", kalanSoz: 8, bekleyenSart: null, sartiSunan: null, imzaSirasiBizde: false, yazismalar: [] };

test("belirsiz emir, model müzakere aracı çağırsa da masaya yazmaz", () => {
  const result = guardNegotiationActions({ message: "Şuna bir bak ve gerekeni yap.", tables: [openTable], neighborCount: 2, actions: [{ name: "reply_negotiation", arguments: { table_ordinal: 1, message: "…" } }] });
  assert.deepEqual(result.actions, []);
  assert.equal(result.blocked, true);
  assert.match(result.notes[0] ?? "", /Müzakere emri açık değildi/);
});

test("açık müzakere emrinde geçerli komşu hedefe masa açılabilir", () => {
  const action = { name: "open_negotiation", arguments: { target_ordinal: 2, topic: "alliance" } };
  const result = guardNegotiationActions({ message: "2. sancakla ittifak müzakeresi aç.", tables: [], neighborCount: 2, actions: [action] });
  assert.deepEqual(result.actions, [action]);
  assert.equal(result.blocked, false);
});

test("açık müzakere emrinde bile hayali hedef durdurulur", () => {
  const result = guardNegotiationActions({ message: "5. sancakla saldırmazlık anlaşması görüş.", tables: [], neighborCount: 2, actions: [{ name: "open_negotiation", arguments: { target_ordinal: 5 } }] });
  assert.deepEqual(result.actions, []);
  assert.match(result.notes[0] ?? "", /geçerli bir hedef/);
});

test("kapalı masa için uydurulan sıra engellenir", () => {
  const result = guardNegotiationActions({ message: "Masadaki teklife cevap ver.", tables: [{ ...openTable, durum: "declined" }], neighborCount: 2, actions: [{ name: "reply_negotiation", arguments: { table_ordinal: 1 } }] });
  assert.deepEqual(result.actions, []);
  assert.match(result.notes[0] ?? "", /açık bir müzakere masası yok/);
});

test("müzakere niyeti yalnızca genel emir fiilinden doğmaz", () => {
  assert.equal(mentionsNegotiation("gerekeni yap"), false);
  assert.equal(mentionsNegotiation("elçiyi 2. sancağa gönder"), true);
  assert.equal(mentionsNegotiation("karşı taraftan paralı asker kiralamayı konuş"), true);
});

test("bekleyen karar temizliği için müzakere araçları ayırt edilir", () => {
  assert.equal(isNegotiationAction({ name: "reply_negotiation" }), true);
  assert.equal(isNegotiationAction({ name: "build_structure" }), false);
});
