import assert from "node:assert/strict";
import test from "node:test";
import { isCouncilInquiry, renderCouncilTranscript } from "../server/general-council-context";

test("Meclis sorusu müzakere bağlamından ayrılır", () => {
  assert.equal(isCouncilInquiry("Divandaki üç görüşü karşılaştır."), true);
  assert.equal(isCouncilInquiry("Halkın görüşüyle Garnizonu karşılaştır."), true);
  assert.equal(isCouncilInquiry("İkinci masaya 250 altın teklif et."), false);
});

test("Divan görüşleri sınırları belli veri bloğunda taşınır", () => {
  const transcript = renderCouncilTranscript([{ role: "commons", speaker: "HALK MECLİSİ", priority: "urgent", mode: "ai", text: "Evler doldu." }]);
  assert.match(transcript, /^<<<DIVAN_GORUSLERI>>>/);
  assert.match(transcript, /HALK MECLİSİ/);
  assert.match(transcript, /<<<DIVAN_GORUSLERI_SON>>>$/);
});
