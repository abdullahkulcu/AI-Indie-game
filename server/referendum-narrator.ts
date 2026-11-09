import { referendumQuestion, type ReferendumTopic, type ReferendumVerdict } from "../engine/referendum";
import { populacePersonaProfile } from "../engine/populace-persona";
import { aiGuidedSystemPrompt } from "./ai-guides";
import { callProviderText, DEFAULT_TEXT_TEMPERATURE } from "./llm-provider";
import { POPULACE_TEXT_LIMIT, sanitizeDemandText } from "./populace-brief";
import type { ResolvedPopulaceCredential } from "./populace-ai-credentials";

const PROMPT = [
  "Sen Demirkale halkının sözcüsüsün. Kralın referandum sonucunu kısa, tamamlanmış bir cümleyle açıkla.",
  `En fazla ${POPULACE_TEXT_LIMIT} karakter kullan; başlık, sayı, yüzde, özel isim, emir ve tehdit yazma.`,
  "Sonuç bağlayıcı değildir; Kral kararını kendisi verir. Yalnızca halkın duygusunu anlat.",
  "Yalnızca cümleyi yaz.",
].join("\n");

export async function narrateReferendum(credential: ResolvedPopulaceCredential, topic: ReferendumTopic, verdict: ReferendumVerdict) {
  try {
    const persona = populacePersonaProfile(credential.persona);
    const user = [`HALKIN HUYU: ${persona?.tone ?? ""}`, `SORU: ${referendumQuestion(topic)}`, `SONUÇ: ${verdict === "supported" ? "çoğunluk destekliyor" : verdict === "opposed" ? "çoğunluk karşı çıkıyor" : "halk ikiye bölünmüş"}`, "Bu sonucu tek cümleyle anlat."].join("\n");
    const text = await callProviderText({ provider: credential.provider, model: credential.model, apiKey: credential.apiKey, system: aiGuidedSystemPrompt("commons", PROMPT), user, maxTokens: 90, temperature: credential.temperature ?? DEFAULT_TEXT_TEMPERATURE });
    const clean = text ? sanitizeDemandText(text) : "";
    return clean.length >= 8 && /[.!?…]$/.test(clean) ? clean : null;
  } catch {
    return null;
  }
}
