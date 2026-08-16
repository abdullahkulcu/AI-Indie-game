import assert from "node:assert/strict";
import test from "node:test";
import { decryptByok, encryptByok } from "../server/byok-crypto";

test("BYOK anahtarı hesap ve model bağlamıyla şifrelenip çözülür", async () => {
  const secret = Buffer.alloc(32, 7).toString("base64url");
  const encrypted = await encryptByok("sk-test-secret", secret, "user-1", "openai", "gpt-test");
  assert.notEqual(encrypted.encryptedKey, "sk-test-secret");
  assert.equal(await decryptByok(encrypted.encryptedKey, encrypted.iv, secret, "user-1", "openai", "gpt-test", encrypted.keyVersion), "sk-test-secret");
  await assert.rejects(() => decryptByok(encrypted.encryptedKey, encrypted.iv, secret, "user-2", "openai", "gpt-test", encrypted.keyVersion));
});
