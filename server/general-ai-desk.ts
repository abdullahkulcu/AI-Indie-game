import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { llmCredentials } from "../db/schema";
import { decryptByok } from "./byok-crypto";

export type GeneralAiCredential = {
  provider: "openai" | "anthropic";
  model: string;
  apiKey: string;
};

export type GeneralAiResolution =
  | { state: "missing" }
  | { state: "invalid" }
  | { state: "connected"; credential: GeneralAiCredential };

/**
 * Oyuncunun General kimliğinin tek okuma/çözme kapısı.
 *
 * Çözülmüş anahtar yalnızca sağlayıcı çağrısı yapacak sunucu koduna döner;
 * HTTP cevabına, deftere veya loga konmaz. `missing` ile `invalid` ayrımı
 * General sohbetinin kullanıcıya doğru onarım mesajını verebilmesi içindir.
 */
export async function generalAiFor(userId: string, masterKey: string): Promise<GeneralAiResolution> {
  const [row] = await getDb().select().from(llmCredentials).where(eq(llmCredentials.userId, userId)).limit(1);
  if (!row) return { state: "missing" };
  try {
    const apiKey = await decryptByok(
      row.encryptedKey, row.iv, masterKey, userId,
      row.provider, row.model, row.keyVersion,
    );
    return { state: "connected", credential: { provider: row.provider, model: row.model, apiKey } };
  } catch {
    return { state: "invalid" };
  }
}
