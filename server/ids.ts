/**
 * Çakışmayan satır kimlikleri.
 *
 * Kusur: müzakere uçları kimliği `ng_${user.id}_${Date.now()}` ve
 * `nm_${row.id}_${Date.now()}_${row.turns}` kalıbıyla üretiyordu. Aynı
 * milisaniyede açılan iki masa ya da aynı bayat `turns` değerini okuyan iki
 * eşzamanlı cevap birincil anahtarı çakıştırıyor ve istek 500 dönüyordu —
 * üstelik Kral hiçbir şey anlamadan sözünü kaybediyordu.
 *
 * Zaman damgası kimliğin İÇİNDE taşınmaz; satırın kendi `at`/`openedAt` sütunu
 * zaten o bilgiyi tutar.
 */
export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}
