import commonGuide from "../ai-guides/ortak-kurallar";
import generalGuide from "../ai-guides/general";
import commonsGuide from "../ai-guides/halk";
import garrisonGuide from "../ai-guides/garnizon";

/**
 * Oyun içi LLM'lerin tek dosya tabanlı davranış sözleşmesi.
 * Workers dosya sistemi okumaz; ayrı metin modülleri derleme anında uygulamaya
 * katılır. Böylece her sağlayıcı çağrısı aynı sürümdeki rehberi görür.
 */
export type AiGuideRole = "general" | "commons" | "garrison";

const roleGuide: Record<AiGuideRole, string> = {
  general: generalGuide,
  commons: commonsGuide,
  garrison: garrisonGuide,
};

export function aiGuidedSystemPrompt(role: AiGuideRole, instruction: string) {
  return [
    "<DEMIRKALE_AI_REHBERI>",
    commonGuide,
    roleGuide[role],
    "</DEMIRKALE_AI_REHBERI>",
    "<GOREV_TALIMATI>",
    instruction.trim(),
    "</GOREV_TALIMATI>",
  ].join("\n");
}
