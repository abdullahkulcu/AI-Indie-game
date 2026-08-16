/**
 * BYOK anahtar güvenliği — GDD §14.6 ve §15.5.
 *
 * Oyuncunun kendi LLM API anahtarı **envelope encryption** ile saklanır:
 *
 *   1. Her anahtar için rastgele bir veri anahtarı (DEK) üretilir.
 *   2. API anahtarı AES-256-GCM ile DEK kullanılarak şifrelenir.
 *   3. DEK'in kendisi kök anahtar (KEK / `MASTER_KEY`) ile sarılır.
 *   4. Veritabanına yalnızca şifreli metin + IV + auth tag + sarılı DEK yazılır.
 *
 * Böylece kök anahtar döndürüldüğünde (rotasyon) tüm kayıtları yeniden
 * şifrelemek gerekmez; yalnızca sarılı DEK'ler yeniden sarılır.
 *
 * Düz metin anahtar hiçbir zaman loglanmaz ve yalnızca sağlayıcı isteği
 * anında bellekte çözülür — bu dosyadaki hiçbir fonksiyon `console`'a yazmaz.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { masterKey } from './config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM için önerilen uzunluk
const DEK_LENGTH = 32;

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDek: Buffer;
}

/** DEK'i kök anahtarla sarar: [iv | authTag | ciphertext] tek bir Buffer'da. */
function wrapDek(dek: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function unwrapDek(wrapped: Buffer): Buffer {
  const iv = wrapped.subarray(0, IV_LENGTH);
  const authTag = wrapped.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = wrapped.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, masterKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const dek = randomBytes(DEK_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, dek, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const wrappedDek = wrapDek(dek);
  // DEK'i bellekte gereğinden uzun tutmayalım.
  dek.fill(0);

  return { ciphertext, iv, authTag, wrappedDek };
}

/**
 * Şifreli anahtarı çözer. Auth tag doğrulaması başarısız olursa (kurcalama ya
 * da yanlış kök anahtar) `createDecipheriv` fırlatır — sessizce bozuk veri
 * dönmez.
 */
export function decryptSecret(secret: EncryptedSecret): string {
  const dek = unwrapDek(secret.wrappedDek);
  try {
    const decipher = createDecipheriv(ALGORITHM, dek, secret.iv);
    decipher.setAuthTag(secret.authTag);
    return Buffer.concat([
      decipher.update(secret.ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/**
 * Anahtarın kendisini açmadan kimliğini karşılaştırabilmek için parmak izi.
 * Sızıntı tespitinde ve "aynı anahtar mı girildi" kontrolünde kullanılır;
 * anahtarın kendisini geri vermez.
 */
export function secretFingerprint(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex').slice(0, 16);
}

/**
 * Bir API anahtarının log/hata mesajında gösterilebilir hâli.
 * Asla tam anahtar döndürmez.
 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return '****';
  return `${plaintext.slice(0, 4)}…${plaintext.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Parola hash'leme (scrypt) — kullanıcı hesapları için
// ---------------------------------------------------------------------------

import { scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1] ?? '', 'hex');
  const expected = Buffer.from(parts[2] ?? '', 'hex');
  if (salt.length === 0 || expected.length !== SCRYPT_KEYLEN) return false;
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  // Zamanlama saldırısına kapalı karşılaştırma.
  return timingSafeEqual(derived, expected);
}

/** Idempotency nonce'ları için kısa, çakışması pratikte imkânsız kimlik. */
export function newNonce(): string {
  return randomBytes(16).toString('hex');
}
