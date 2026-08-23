import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { POPULACE_PERSONA_IDS, POPULACE_PERSONAS, isPopulacePersona } from "../engine/populace-persona";
import {
  decryptByok, decryptScopedKey, encryptByok, encryptScopedKey,
  populaceChannelScope, populaceKingdomScope, userScope,
} from "../server/byok-crypto";
import {
  POPULACE_SUMMARY_COLUMNS, type PopulaceCredentialRow,
  pickPopulaceCredential, populaceCredentialSummary, populaceScopeOf, resolvePopulaceCredential,
} from "../server/populace-ai-credentials";

/**
 * HALK-AI KİMLİK ALTYAPISI (plan belgesi, Fikir 0).
 *
 * Dört sınır burada ölçülür ve dördü de güvenlik sınırı:
 *  1. Bugüne kadar şifrelenmiş OYUNCU anahtarları hâlâ çözülüyor (aşağıdaki
 *     sabit "altın örnek" değişiklikten ÖNCEKİ kodla üretildi).
 *  2. Halk-AI anahtarı kendi kapsamıyla çözülüyor.
 *  3. Bir channel'ın anahtarı başka bir channel (ya da bir kullanıcı) adına
 *     çözülemiyor — kapsam sızıntısı yok.
 *  4. Panele/uca dönen özet sır taşımıyor.
 */

const SECRET = Buffer.alloc(32, 3).toString("base64url");

/**
 * DEĞİŞİKLİKTEN ÖNCEKİ kodla (`additionalData(userId, provider, model, version)`)
 * üretilmiş gerçek bir şifre metni. Kapsam genellemesi AAD baytlarını bozmuş
 * olsaydı bu test kırmızıya döner — ve gerçekte olan şey TÜM oyuncuların
 * Generalini kaybetmesi olurdu. Bu yüzden burada sabit tutulur; yeniden
 * üretilmez.
 */
const GOLDEN = {
  secret: "CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws",
  encryptedKey: "2DtrGrpL5u4PiVww4xvZpE88nOAxv7Q_s3CPnqG1JEjapJYa2WCQCA",
  iv: "0oc53Ilx-_MprL60",
  userId: "kral-1",
  provider: "openai",
  model: "gpt-eski",
  keyVersion: "v1",
  apiKey: "sk-eski-surumun-anahtari",
};

test("ESKİ kodla şifrelenmiş oyuncu anahtarı hâlâ çözülür (geriye dönük uyum)", async () => {
  assert.equal(
    await decryptByok(GOLDEN.encryptedKey, GOLDEN.iv, GOLDEN.secret, GOLDEN.userId, GOLDEN.provider, GOLDEN.model, GOLDEN.keyVersion),
    GOLDEN.apiKey,
    "v1 AAD biçimi bit düzeyinde korunmalı: bozulursa her oyuncu Generalini kaybeder",
  );
  // Aynı anahtar yeni kapsamlı arayüzden de çözülebilir: oyuncu kapsamı ÇIPLAK userId'dir.
  assert.equal(
    await decryptScopedKey(GOLDEN.encryptedKey, GOLDEN.iv, GOLDEN.secret, userScope(GOLDEN.userId), GOLDEN.provider, GOLDEN.model, GOLDEN.keyVersion),
    GOLDEN.apiKey,
  );
});

test("oyuncu anahtarı hâlâ başka bir kullanıcı adına çözülemez", async () => {
  const encrypted = await encryptByok("sk-oyuncu", SECRET, "kral-1", "openai", "gpt-test");
  assert.equal(await decryptByok(encrypted.encryptedKey, encrypted.iv, SECRET, "kral-1", "openai", "gpt-test", encrypted.keyVersion), "sk-oyuncu");
  await assert.rejects(() => decryptByok(encrypted.encryptedKey, encrypted.iv, SECRET, "kral-2", "openai", "gpt-test", encrypted.keyVersion));
});

test("Halk-AI anahtarı kendi kapsamıyla şifrelenip çözülür", async () => {
  const scope = populaceChannelScope("channel-a");
  const encrypted = await encryptScopedKey("sk-halk", SECRET, scope, "anthropic", "halk-modeli");
  assert.notEqual(encrypted.encryptedKey, "sk-halk");
  assert.equal(await decryptScopedKey(encrypted.encryptedKey, encrypted.iv, SECRET, scope, "anthropic", "halk-modeli", encrypted.keyVersion), "sk-halk");
});

test("bir channel'ın anahtarı başka kapsamla çözülemez", async () => {
  const encrypted = await encryptScopedKey("sk-halk", SECRET, populaceChannelScope("channel-a"), "openai", "m");
  const attempts = [
    populaceChannelScope("channel-b"),                 // başka channel
    populaceKingdomScope("channel-a", "kral-1"),       // aynı channel, krallık kapsamı
    userScope("channel-a"),                            // channelId'yi userId yerine kaçak sokma
  ];
  for (const scope of attempts) {
    await assert.rejects(
      () => decryptScopedKey(encrypted.encryptedKey, encrypted.iv, SECRET, scope, "openai", "m", encrypted.keyVersion),
      `kapsam sızıntısı: ${scope}`,
    );
  }
});

test("krallık kapsamı channel'ı da taşır", async () => {
  // Aynı Kralın BAŞKA bir channel'daki override'ı bu anahtarı çözmemeli.
  const encrypted = await encryptScopedKey("sk-halk", SECRET, populaceKingdomScope("channel-a", "kral-1"), "openai", "m");
  assert.equal(await decryptScopedKey(encrypted.encryptedKey, encrypted.iv, SECRET, populaceKingdomScope("channel-a", "kral-1"), "openai", "m", encrypted.keyVersion), "sk-halk");
  await assert.rejects(() => decryptScopedKey(encrypted.encryptedKey, encrypted.iv, SECRET, populaceKingdomScope("channel-b", "kral-1"), "openai", "m", encrypted.keyVersion));
});

test("model AAD'ye girdiği için model değişimi yeniden şifreleme ister", async () => {
  // `/api/byok` PATCH'in ve Halk-AI PATCH'inin varlık sebebi: sütunu tek başına
  // güncellemek anahtarı çözülemez hâle getirir ve halk sessizce susardı.
  const scope = populaceChannelScope("channel-a");
  const encrypted = await encryptScopedKey("sk-halk", SECRET, scope, "openai", "eski-model");
  await assert.rejects(() => decryptScopedKey(encrypted.encryptedKey, encrypted.iv, SECRET, scope, "openai", "yeni-model", encrypted.keyVersion));
});

test("kapsam seçimi yazma ile okuma arasında ayrışmaz", () => {
  assert.equal(populaceScopeOf("channel-a", null), populaceChannelScope("channel-a"));
  assert.equal(populaceScopeOf("channel-a", "kral-1"), populaceKingdomScope("channel-a", "kral-1"));
  assert.notEqual(populaceScopeOf("channel-a", null), populaceScopeOf("channel-a", "kral-1"));
});

// --- Çözümleme sırası ----------------------------------------------------

const rows = [
  { id: "d", channelId: "channel-a", userId: null },
  { id: "k", channelId: "channel-a", userId: "kral-1" },
  { id: "b", channelId: "channel-b", userId: null },
];

test("krallık override'ı channel varsayılanını yener", () => {
  const picked = pickPopulaceCredential(rows, "channel-a", "kral-1");
  assert.equal(picked?.row.id, "k");
  assert.equal(picked?.source, "kingdom");
});

test("override yoksa channel varsayılanı kullanılır", () => {
  const picked = pickPopulaceCredential(rows, "channel-a", "kral-2");
  assert.equal(picked?.row.id, "d");
  assert.equal(picked?.source, "channel");
});

test("varsayılan da yoksa Halk-AI yoktur", () => {
  const onlyOverrides = [{ id: "k", channelId: "channel-a", userId: "kral-1" }];
  assert.equal(pickPopulaceCredential(onlyOverrides, "channel-a", "kral-2"), null);
  assert.equal(pickPopulaceCredential(rows, "channel-c", "kral-1"), null);
});

test("başka channel'ın satırı bu krallığa sızmaz", () => {
  // "b" satırı channel-b'nin varsayılanı; channel-a'lı Kral onu ASLA almamalı.
  const picked = pickPopulaceCredential(rows, "channel-b", "kral-1");
  assert.equal(picked?.row.id, "b");
  assert.equal(pickPopulaceCredential([{ id: "b", channelId: "channel-b", userId: null }], "channel-a", "kral-1"), null);
});

async function row(id: string, channelId: string, userId: string | null, apiKey: string): Promise<PopulaceCredentialRow> {
  const value = await encryptScopedKey(apiKey, SECRET, populaceScopeOf(channelId, userId), "openai", "m");
  return { id, channelId, userId, persona: "isyankar", provider: "openai", model: "m", ...value };
}

test("çözümleyici doğru satırı çözer ve kişiliğiyle döner", async () => {
  const stored = [await row("d", "channel-a", null, "sk-varsayilan"), await row("k", "channel-a", "kral-1", "sk-krallik")];
  const override = await resolvePopulaceCredential(stored, "channel-a", "kral-1", SECRET);
  assert.equal(override?.apiKey, "sk-krallik");
  assert.equal(override?.source, "kingdom");
  const fallback = await resolvePopulaceCredential(stored, "channel-a", "kral-2", SECRET);
  assert.equal(fallback?.apiKey, "sk-varsayilan");
  assert.equal(fallback?.source, "channel");
  assert.equal(fallback?.persona, "isyankar");
  assert.equal(await resolvePopulaceCredential(stored, "channel-c", "kral-1", SECRET), null);
});

test("çözülemeyen satır 'Halk-AI yok' demektir, hata fırlatmaz", async () => {
  // Ana anahtar değişmiş ya da satır elle bozulmuş olabilir; halkın sesi
  // deterministik yedeğine düşer, uç 500 vermez.
  const bozuk = [{ ...(await row("d", "channel-a", null, "sk-varsayilan")), iv: "0oc53Ilx-_MprL60" }];
  assert.equal(await resolvePopulaceCredential(bozuk, "channel-a", "kral-1", SECRET), null);
});

// --- Sır sızıntısı -------------------------------------------------------

test("özet sır taşımaz", () => {
  const summary = populaceCredentialSummary({
    id: "d", channelId: "channel-a", userId: null, persona: "zeki_istekli",
    provider: "openai", model: "m", updatedAt: null,
    // Fazla alanlar kasten veriliyor: özet yayılım kullanıyorsa sızarlar.
    ...{ encryptedKey: "SIR-SIFRELI", iv: "SIR-IV", keyVersion: "v1" },
  } as never);
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /SIR-SIFRELI|SIR-IV/, "şifreli anahtar ve iv özete sızmamalı");
  assert.doesNotMatch(serialized, /encryptedKey|"iv"|keyVersion/, "sır sütunlarının ADI bile özete girmemeli");
  assert.equal(summary.scope, "channel");
  assert.equal(summary.connected, true);
});

test("panelin okuduğu SELECT listesi sır sütunu içermez", () => {
  const columns = Object.keys(POPULACE_SUMMARY_COLUMNS);
  for (const secret of ["encryptedKey", "iv", "keyVersion"]) {
    assert.equal(columns.includes(secret), false, `${secret} panel sorgusuna girmemeli`);
  }
  assert.deepEqual(columns.sort(), ["channelId", "id", "model", "persona", "provider", "updatedAt", "userId"]);
});

/**
 * Uç rotası testten import EDİLEMEZ (`cloudflare:workers`), bu yüzden uçtaki
 * uygulanış kaynak metin üzerinden kilitlenir — `tests/negotiation.test.ts`
 * ve `tests/migration.test.ts` ile aynı desen.
 */
const routeSource = readFileSync(new URL("../app/api/admin/populace-ai/route.ts", import.meta.url), "utf8");
const deskSource = readFileSync(new URL("../server/populace-ai-desk.ts", import.meta.url), "utf8");
const ruleSource = readFileSync(new URL("../server/populace-ai-credentials.ts", import.meta.url), "utf8");

test("admin ucu cevabında anahtar ya da iv geçmez", () => {
  // Cevaplar TEK yoldan kurulur; şifreli anahtar hiçbir Response.json'a girmez.
  assert.match(routeSource, /populaceCredentialSummary/, "cevaplar özet fonksiyonundan kurulmalı");
  const responseLines = routeSource.split("\n").filter(line => line.includes("Response.json"));
  assert.ok(responseLines.length >= 8, "cevap satırları taranabilmeli");
  for (const line of responseLines) {
    for (const secret of ["encryptedKey", "iv:", "apiKey", "BYOK_MASTER_KEY", "keyVersion"]) {
      assert.equal(line.includes(secret), false, `sır cevaba konmamalı: ${secret} → ${line.trim()}`);
    }
  }
  // Sır hiçbir yere yazılmaz: log yok.
  for (const [name, source] of [["uç", routeSource], ["masa", deskSource], ["kural", ruleSource]] as const) {
    assert.doesNotMatch(source, /console\.(log|warn|error|info|debug)/, `${name} dosyasında log olmamalı (CLAUDE.md kısıt #4)`);
  }
});

test("uç yetki denetimini her metotta yapar", () => {
  const guards = routeSource.match(/currentAdminUser\(request\)/g) ?? [];
  const methods = routeSource.match(/export async function (GET|PUT|PATCH|DELETE)/g) ?? [];
  assert.equal(methods.length, 4, "GET/PUT/PATCH/DELETE dördü de olmalı");
  assert.equal(guards.length, methods.length, "her metot yönetici yetkisini sormalı");
});

test("uç kapsamı ve kişilik listesini tek kaynaktan okur", () => {
  assert.match(routeSource, /populaceScopeOf\(channelId, userId\)/, "kapsam çözümleyicinin fonksiyonundan gelmeli");
  assert.match(routeSource, /isPopulacePersona/, "kişilik doğrulaması motordaki listeden gelmeli");
  assert.doesNotMatch(routeSource, /"isyankar"|"zeki_istekli"|"bagli_itaatkar"/, "kişilik kimlikleri uca elle yazılmamalı");
  const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(schema, /enum: POPULACE_PERSONA_IDS/, "şema kısıtı da aynı listeden türemeli");
});

// --- Kişilik listesi -----------------------------------------------------

test("kişilik listesi ve tipi ayrışmaz", () => {
  assert.deepEqual(POPULACE_PERSONAS.map(persona => persona.id), [...POPULACE_PERSONA_IDS]);
  for (const id of POPULACE_PERSONA_IDS) assert.equal(isPopulacePersona(id), true);
  assert.equal(isPopulacePersona("hizip"), false);
  assert.equal(isPopulacePersona(""), false);
  for (const persona of POPULACE_PERSONAS) {
    assert.ok(persona.label.length > 2, `${persona.id} panelde görünecek bir ada sahip olmalı`);
    assert.ok(persona.tone.length > 30, `${persona.id} tonu prompt kurmaya yetecek kadar anlatılmalı`);
  }
});
