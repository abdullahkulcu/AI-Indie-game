import { populacePersonaProfile, type PopulacePersona } from "../engine/populace-persona";
import type { FeedCue, FeedCueKind } from "../engine/populace-feed";
import { aiGuidedSystemPrompt } from "./ai-guides";
import { callProviderText, DEFAULT_TEXT_TEMPERATURE } from "./llm-provider";
import { POPULACE_TEXT_LIMIT, sanitizeDemandText } from "./populace-brief";
import type { ResolvedPopulaceCredential } from "./populace-ai-credentials";

/** Talep değil, atmosferik günce; maliyetin küçük kalması için kısa tutulur. */
const FEED_MAX_TOKENS = 90;

const FEED_PROMPT = [
  "Sen Demirkale adlı ortaçağ krallık oyununda halkın meydandaki gündelik sesisin.",
  "Kraldan bir şey istemiyorsun; emir, öğüt, tehdit veya talep yazma.",
  `Tek, tamamlanmış bir cümle yaz. En fazla ${POPULACE_TEXT_LIMIT} karakter; başlık, madde imi, tırnak, emoji ve selam yok.`,
  "Hiçbir sayı, yüzde, özel isim ya da krallık adı yazma. Komşudan söz edilirse yalnızca adsız bir söylenti olarak kalmalı.",
  "Birinci çoğul şahıs kullanma zorunluluğun yok; meydan, pazar ve evlerin diliyle kısa bir gündelik gözlem yaz.",
  "Yalnızca cümleyi yaz.",
].join("\n");

export type FeedNarrationCue = Pick<FeedCue, "kind" | "subject">;

export function feedNarrationPrompt(cue: FeedNarrationCue & { persona: PopulacePersona }) {
  const persona = populacePersonaProfile(cue.persona);
  return [`HALKIN HUYU: ${persona?.tone ?? ""}`, `GÜNDEM: ${cue.subject}`, "Bu gündemi tek kısa cümleyle anlat."].join("\n");
}

export type FeedNarrator = (cue: FeedNarrationCue) => Promise<string | null>;

/** Sağlayıcı hatası feed'i düşürür; bir hata asla talep ya da oyun sonucunu değiştirmez. */
export function populaceFeedNarrator(credential: ResolvedPopulaceCredential): FeedNarrator {
  return async (cue) => {
    try {
      const text = await callProviderText({
        provider: credential.provider,
        model: credential.model,
        apiKey: credential.apiKey,
        system: aiGuidedSystemPrompt("commons", FEED_PROMPT),
        user: feedNarrationPrompt({ ...cue, persona: credential.persona }),
        maxTokens: FEED_MAX_TOKENS,
        temperature: credential.temperature ?? DEFAULT_TEXT_TEMPERATURE,
      });
      const clean = text ? sanitizeDemandText(text) : "";
      return clean.length >= 8 && /[.!?…]$/.test(clean) ? clean : null;
    } catch {
      return null;
    }
  };
}

export type { FeedCueKind };
