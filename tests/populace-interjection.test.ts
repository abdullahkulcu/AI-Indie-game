import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_INTERJECTIONS_PER_TURN, generalHistory, interjectionKey, interjectionSpeaker, pickInterjections,
  type ChatLine, type InterjectionDemand,
} from "../components/populace-interjection";

const T0 = 1_800_000_000_000;

function demand(overrides: Partial<InterjectionDemand> = {}): InterjectionDemand {
  return {
    kind: "bread", voice: "commons", text: "Ekmek yok, üç gündür çocuklar aç.",
    severity: "urgent", since: T0, ...overrides,
  };
}

test("yalnızca acil talep meclise girer; normal talep Halk sekmesinde kalır", () => {
  assert.deepEqual(pickInterjections([demand()], new Set()).map(item => item.kind), ["bread"]);
  assert.deepEqual(pickInterjections([demand({ severity: "normal" })], new Set()), []);
});

test("metni boş gelen talep konuşmaz: boş bir balon Kralı yalnızca yorar", () => {
  assert.deepEqual(pickInterjections([demand({ text: "   " })], new Set()), []);
});

test("aynı talep için ikinci kez balon açılmaz", () => {
  const open = demand();
  const spoken = new Set<string>();
  const first = pickInterjections([open], spoken);
  assert.equal(first.length, 1);
  for (const item of first) spoken.add(interjectionKey(item));
  assert.deepEqual(pickInterjections([open], spoken), [], "süregelen talep bir kez konuşur");
});

test("kapanıp YENİDEN açılan talep yeniden söz alır: kimlik tür değil, tür+açılış anı", () => {
  const spoken = new Set([interjectionKey(demand())]);
  const reopened = demand({ since: T0 + 86_400_000 });
  assert.deepEqual(pickInterjections([reopened], spoken).map(item => item.since), [reopened.since]);
});

test("bir turda en fazla bir balon; ikinci acil talep sıradaki tura kalır", () => {
  const both = [demand(), demand({ kind: "wage", voice: "garrison" })];
  const picked = pickInterjections(both, new Set());
  assert.equal(picked.length, MAX_INTERJECTIONS_PER_TURN);
  assert.equal(picked[0].kind, "bread", "sunucunun gönderdiği öncelik sırası korunur");
});

test("kışla ve halk ayrı ağızlardır", () => {
  assert.equal(interjectionSpeaker("commons"), "HALKIN SESİ");
  assert.equal(interjectionSpeaker("garrison"), "KIŞLANIN SESİ");
});

/**
 * KRİTİK: halkın satırı General'e giden geçmişte YOKTUR.
 *
 * Geçmiş eskiden "Kral değilse General" diye kuruluyordu; halkın balonu
 * sohbete girdiği anda General bir sonraki turda halkın şikâyetini KENDİ sözü
 * sanardı. Bu test o tuzağın nöbetçisi.
 */
test("halkın satırı General'e giden geçmişe hiç girmez", () => {
  const chat: ChatLine[] = [
    { who: "Kral Aslan", text: "Ambarları say.", kind: "king" },
    { who: "HALKIN SESİ", text: "Ekmek yok, üç gündür çocuklar aç.", kind: "populace", voice: "commons" },
    { who: "General Aldric", text: "Ambar 400 tahıl.", kind: "general" },
  ];
  const history = generalHistory(chat);
  assert.deepEqual(history, [
    { role: "king", text: "Ambarları say." },
    { role: "general", text: "Ambar 400 tahıl." },
  ]);
  assert.equal(history.some(item => item.text.includes("çocuklar aç")), false);
});

test("Saray Kâtibi'nin hata bildirimi de General'in sözü sayılmaz", () => {
  const chat: ChatLine[] = [
    { who: "Kral Aslan", text: "Duvarı yükselt.", kind: "king" },
    { who: "Saray Kâtibi", text: "General bağlantısı etkin değil.", kind: "clerk" },
  ];
  assert.deepEqual(generalHistory(chat), [{ role: "king", text: "Duvarı yükselt." }]);
});

test("süzgeç dilimden ÖNCE işler: halk balonu General'in gerçek turunu yerinden etmez", () => {
  const chat: ChatLine[] = [
    { who: "HALKIN SESİ", text: "Vergi belimizi kırdı.", kind: "populace", voice: "commons" },
    { who: "HALKIN SESİ", text: "Ekmek yok.", kind: "populace", voice: "commons" },
    { who: "Kral Aslan", text: "bir", kind: "king" },
    { who: "General Aldric", text: "iki", kind: "general" },
  ];
  assert.deepEqual(generalHistory(chat, 2), [
    { role: "king", text: "bir" },
    { role: "general", text: "iki" },
  ]);
});

test("geçmiş sınırı son turları tutar, ilkleri düşürür", () => {
  const chat: ChatLine[] = Array.from({ length: 12 }, (_, index) => ({
    who: "Kral Aslan", text: `emir ${index}`, kind: "king" as const,
  }));
  const history = generalHistory(chat);
  assert.equal(history.length, 8);
  assert.equal(history[0].text, "emir 4");
  assert.equal(history.at(-1)?.text, "emir 11");
});
