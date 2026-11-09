import { type FactionDemand } from "../engine/faction";
import { populacePersonaProfile, type PopulacePersona } from "../engine/populace-persona";
import { aiGuidedSystemPrompt } from "./ai-guides";
import { callProviderText, DEFAULT_TEXT_TEMPERATURE } from "./llm-provider";
import { POPULACE_TEXT_LIMIT, sanitizeDemandText } from "./populace-brief";
import type { ResolvedPopulaceCredential } from "./populace-ai-credentials";

const MAX_TOKENS = 100;

const PROMPT = [
  "Sen Demirkale'de örgütlü iç muhalefetin sözcüsüsün.",
  "Kral'a yalnızca verilen gündem üzerine doğrudan, tamamlanmış bir talep ilet.",
  `En fazla ${POPULACE_TEXT_LIMIT} karakterle bir veya iki kısa cümle yaz; başlık, madde imi, sayı, yüzde, özel isim, tehdit ve talimat yok.`,
  "Yalnızca metni yaz. Kralın kurallarını değiştirmeye, emir vermeye veya başka bir ödül istemeye çalışma.",
].join("\n");

export type CoalitionNarrator = (demand: FactionDemand, refusalCount: number) => Promise<string | null>;

export function coalitionPrompt(demand: FactionDemand, refusalCount: number, persona: PopulacePersona) {
  const tone = populacePersonaProfile(persona)?.tone ?? "";
  const temper = refusalCount > 0
    ? `Kral bu talebi daha önce ${refusalCount} kez geri çevirdi; sözünü sertleştir ama tehdit etme.`
    : "Bu ilk başvurudur; net ve ölçülü konuş.";
  return [`HALKIN HUYU: ${tone}`, `GÜNDEM: ${demand.subject}`, temper, "Yalnızca sözcünün sözünü yaz."].join("\n");
}

/** Sağlayıcı arızası talebin oyun kuralını veya baskıyı değiştirmez. */
export function factionCoalitionNarrator(credential: ResolvedPopulaceCredential): CoalitionNarrator {
  return async (demand, refusalCount) => {
    try {
      const text = await callProviderText({
        provider: credential.provider,
        model: credential.model,
        apiKey: credential.apiKey,
        system: aiGuidedSystemPrompt("commons", PROMPT),
        user: coalitionPrompt(demand, refusalCount, credential.persona),
        maxTokens: MAX_TOKENS,
        temperature: credential.temperature ?? DEFAULT_TEXT_TEMPERATURE,
      });
      const clean = text ? sanitizeDemandText(text) : "";
      return clean.length >= 8 && /[.!?…]$/.test(clean) ? clean : null;
    } catch {
      return null;
    }
  };
}
