import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, PBKDF2_ITERATIONS, verifyPassword } from "../server/password-auth.js";

test("şifre özeti Workers sınırını aşmaz ve doğrulanır", async () => {
  assert.equal(PBKDF2_ITERATIONS, 100_000);
  const encoded = await hashPassword("demirkale-test-password");
  assert.match(encoded, /^pbkdf2:100000:/);
  assert.equal(await verifyPassword("demirkale-test-password", encoded), true);
  assert.equal(await verifyPassword("yanlış-şifre", encoded), false);
});

test("desteklenmeyen PBKDF2 tur sayısı çalıştırılmadan reddedilir", async () => {
  assert.equal(await verifyPassword("x", "pbkdf2:210000:c2FsdA:aGFzaA"), false);
});
