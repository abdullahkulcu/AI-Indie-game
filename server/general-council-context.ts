import type { CouncilVoice } from "./council-advisors";

/** Meclis sorusu, açık müzakere masası bağlamını cevaba taşımamalıdır. */
const COUNCIL_INQUIRY = /(meclis|divan|üç görüş|3 görüş|halkın görüşü|garnizonun görüşü|kışlanın görüşü|divandaki)/iu;

export function isCouncilInquiry(message: string | undefined) {
  return Boolean(message && COUNCIL_INQUIRY.test(message));
}

/** Divan sesleri kullanıcı verisi olarak taşınır; General bunları kendi talimatı sanmaz. */
export function renderCouncilTranscript(voices: CouncilVoice[]) {
  if (!voices.length) return "";
  return [
    "<<<DIVAN_GORUSLERI>>>",
    JSON.stringify(voices.map(voice => ({ rol: voice.role, konusan: voice.speaker, oncelik: voice.priority, gorus: voice.text }))),
    "<<<DIVAN_GORUSLERI_SON>>>",
  ].join("\n");
}
