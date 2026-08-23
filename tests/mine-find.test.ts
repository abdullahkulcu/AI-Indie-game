import assert from "node:assert/strict";
import test from "node:test";
import {
  MINE_FINDS, MINE_FIND_KINDS, MINE_FIND_SEED_BUCKET_GAME_HOURS,
  mineFindOf, mineFindSeedAt, type MineFindKind,
} from "../engine/mine";

/**
 * DAMAR TÜKENİNCE ÇIKAN FIRSAT (plan belgesi Fikir 23).
 *
 * Kararın üç yarısı test ediliyor: tür/büyüklük/konum TOHUMLU (admin
 * müdahalesi gerekmez), ödül bandı DAR (tohum avlamak kârlı olmasın) ve
 * tohumun anı KABA (son cevheri alan oyuncu yoklama anını seçebiliyor).
 * "Tek kazanan" kuralı veritabanı seviyesinde (koşullu UPDATE) yaşıyor,
 * bu yüzden burada değil route'ta.
 */

const NOW = 1_800_000_000_000;

test("aynı tohum aynı fırsatı verir; farklı tohum farklı fırsat", () => {
  assert.deepEqual(mineFindOf("kanal-1:1000"), mineFindOf("kanal-1:1000"));
  const kinds = new Set<string>(), amounts = new Set<number>();
  for (let index = 0; index < 300; index += 1) {
    const find = mineFindOf(`kanal-${index}:${NOW}`);
    kinds.add(find.kind);
    amounts.add(find.amount);
  }
  // Üç türün hepsi çıkabiliyor: tohum tek bir türe saplanmış değil.
  assert.equal(kinds.size, MINE_FIND_KINDS.length, `çıkan türler: ${[...kinds].join(", ")}`);
  assert.ok(amounts.size > 50, `miktar neredeyse sabit: ${amounts.size} farklı değer`);
});

test("tür, kaynak ve miktar katalogla tutarlıdır", () => {
  for (let index = 0; index < 400; index += 1) {
    const find = mineFindOf(`kanal:${index}`);
    const catalog = MINE_FINDS[find.kind as MineFindKind];
    assert.ok(catalog, `bilinmeyen tür: ${find.kind}`);
    assert.equal(find.resource, catalog.resource, "ödül kalemi katalogdan sapmış");
    assert.equal(find.label, catalog.label);
    assert.ok(Number.isInteger(find.amount), `miktar tam sayı değil: ${find.amount}`);
    assert.ok(find.amount >= catalog.min && find.amount <= catalog.max, `miktar bandın dışında: ${find.amount}`);
  }
});

test("ödül bandı DAR: tohum avlamak kârlı olmasın", () => {
  // İSTİSMAR FRENİ. Tükenme anını, damarın son cevherini alan oyuncu bir
  // ölçüde seçebiliyor (maden tembel ilerliyor). Bantlar birbirine yakın
  // olduğu sürece "hangi anda yoklarsam define çıkar" diye taramak zahmete
  // değmez. Bu test bandı genişletmeye çalışan bir değişikliği yakalar.
  const values = MINE_FIND_KINDS.flatMap(kind => [MINE_FINDS[kind].min, MINE_FINDS[kind].max]);
  const spread = Math.max(...values) / Math.min(...values);
  assert.ok(spread <= 2, `en iyi ile en kötü fırsat arasındaki fark çok büyük: ×${spread.toFixed(2)}`);
  for (const kind of MINE_FIND_KINDS) {
    assert.ok(MINE_FINDS[kind].max > MINE_FINDS[kind].min, `${kind} bandı ters ya da sabit`);
  }
});

test("konum madenin çevresinde kalır", () => {
  for (let index = 0; index < 200; index += 1) {
    const { offset } = mineFindOf(`kanal:${index}`);
    assert.ok(Math.abs(offset.x) <= 12 && Math.abs(offset.z) <= 12, `fırsat haritanın dışına düştü: ${offset.x},${offset.z}`);
  }
  // Konum da tohumlu: aynı tohum aynı yeri verir.
  assert.deepEqual(mineFindOf("kanal:5").offset, mineFindOf("kanal:5").offset);
});

test("tohumun anı kaba bir kovaya oturur; hız kovayı ölçekler", () => {
  const bucket = MINE_FIND_SEED_BUCKET_GAME_HOURS * 3_600_000;
  const base = Math.floor(NOW / bucket) * bucket;
  // Aynı oyun saati içindeki iki farklı an AYNI tohumu verir: milisaniye
  // taramak işe yaramaz.
  assert.equal(mineFindSeedAt(base + 1, 1), base);
  assert.equal(mineFindSeedAt(base + bucket - 1, 1), base);
  assert.equal(mineFindSeedAt(base + bucket, 1), base + bucket);
  assert.deepEqual(mineFindOf(`k:${mineFindSeedAt(base + 5_000, 1)}`), mineFindOf(`k:${mineFindSeedAt(base + 900_000, 1)}`));
  // Hızlı channel'da oyun saati kısadır, kova da kısalır.
  assert.ok(mineFindSeedAt(base + bucket / 2, 24) > base, "×24 hızda kova daralmadı");
  assert.equal(mineFindSeedAt(base, 0), mineFindSeedAt(base, 1), "bozuk hız kovayı bozmamalı");
});
