import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";

function vaultKey(): Buffer {
  const key = Buffer.from(env.keyVaultSecret, "hex");
  if (key.length !== 32) {
    throw new Error("KEY_VAULT_SECRET must be 64 hex chars (32 bytes) for AES-256-GCM");
  }
  return key;
}

export interface EncryptedSecret {
  encrypted: string;
  iv: string;
  authTag: string;
}

/** Encrypts a user's raw LLM API key before it ever touches the database. */
export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, vaultKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  return {
    encrypted: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

/** Decrypts a stored API key. Only ever called server-side, right before an LLM call. */
export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, vaultKey(), Buffer.from(secret.iv, "hex"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(secret.encrypted, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}
