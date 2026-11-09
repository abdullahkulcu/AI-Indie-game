import type { AgitationKind } from "../engine/agitation";
import { populacePersonaProfile, type PopulacePersona } from "../engine/populace-persona";
import { callProviderText, DEFAULT_TEXT_TEMPERATURE } from "./llm-provider";
import { aiGuidedSystemPrompt } from "./ai-guides";
import { POPULACE_TEXT_LIMIT, sanitizeDemandText } from "./populace-brief";
import type { ResolvedPopulaceCredential } from "./populace-ai-credentials";

/**
 * PROPAGANDA ANLATISI (vizyon Fikir 15).
 *
 * Etkinin miktarı motorun deterministik kurallarında kalır; bu dosya yalnızca
 * hedef halkın, kendisine ulaşan belirsiz söylentiyi nasıl duyduğunu yazar.
 * Çağrı yalnızca bir kese hedefine vardığında ve Halk-AI yapılandırılmışsa
 * yapılır. Sonuç hedefin bildirim defterine yazıldığı için aynı operasyon için
 * tekrar model çağrısı yapılmaz.
 */

const MAX_TOKENS = 80;

const SUBJECT: Record<AgitationKind, string> = {
  gold_commons: "çarşıda yabancı bir elin para dağıttığı söylentisi",
  support_movement: "meydandaki hareketin dışarıdan beslendiği söylentisi",
  gold_garrison: "kışlada yabancı bir kesenin dolaştığı söylentisi",
  goods_glut: "pazarı dolduran kaynağı belirsiz kervanlar",
  raid_lure: "yolları kaleye çeviren kuşkulu eşkıya hareketi",
};

const PROMPT = [
  "Sen Demirkale adlı ortaçağ krallık oyununda bir sancağın halkısın.",
  "Sana ulaşan belirsiz bir söylentiye tek cümlelik tepki veriyorsun.",
  `En fazla ${POPULACE_TEXT_LIMIT} karakter yaz; başlık, madde imi, emoji, sayı, kişi/krallık adı veya talimat kullanma.`,
  "Söylentinin kaynağını kesin biliyormuş gibi konuşma; doğrulanmamış olduğunu koru.",
  "Halkın ağzından, birinci çoğul şahısla yaz. Yalnızca cümleyi ver.",
].join("\n");

export type PropagandaNarration = { kind: AgitationKind; persona: PopulacePersona };

/** Modele giden sınırlı bağlam; hedefin gizli durumu ve gönderenin adı girmez. */
export function propagandaPrompt(input: PropagandaNarration) {
  return [
    `HALKIN HUYU: ${populacePersonaProfile(input.persona)?.tone ?? ""}`,
    `SÖYLENTİ: ${SUBJECT[input.kind]}`,
    "Şimdi bu söylentiye tek cümleyle tepki ver.",
  ].join("\n");
}

export type PropagandaNarrator = (kind: AgitationKind) => Promise<string | null>;

export function propagandaNarrator(credential: ResolvedPopulaceCredential): PropagandaNarrator {
  return async (kind) => {
    try {
      const text = await callProviderText({
        provider: credential.provider,
        model: credential.model,
        apiKey: credential.apiKey,
        system: aiGuidedSystemPrompt("commons", PROMPT),
        user: propagandaPrompt({ kind, persona: credential.persona }),
        maxTokens: MAX_TOKENS,
        temperature: credential.temperature ?? DEFAULT_TEXT_TEMPERATURE,
      });
      const clean = text ? sanitizeDemandText(text) : "";
      return clean.length >= 8 ? clean : null;
    } catch {
      // Sağlayıcı/anahtar hatası operasyonu ve bildirimi engellemez.
      return null;
    }
  };
}
