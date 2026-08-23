/**
 * General'in defteri: Kral hakkında biriken kalıcı hafıza.
 *
 * Son sekiz mesajlık konuşma penceresi General'i bir karaktere değil komut
 * yönlendiricisine çeviriyordu. Defter, tek tek emirleri değil Kralın YÖNETİM
 * HUYUNU tutar: itirazı kaç kez ezdiği, hazineyi hep son ana kadar boşalttığı,
 * halkın karnını doyurmayı önemsediği. Böylece General geçmişe atıfta bulunabilir.
 *
 * Bu modül saftır: veritabanı, ağ ve tarih (`Date.now`) kullanmaz. Kalıcılık
 * `server/general-ledger.ts` içindedir.
 *
 * Maliyet disiplini: her madde ayrı satır olarak birikmez. Aynı türden olaylar
 * TEK maddede toplanır ve `weight` (kaç kez olduğu) artar. "Kral üç kez itirazımı
 * ezdi" üç satır değil, ağırlığı 3 olan tek satırdır. Böylece defter hem kısa
 * kalır hem de tekrar eden davranış güçlenerek görünür.
 */

/**
 * Defter madde türleri — TEK KAYNAK, dizi hâlinde.
 *
 * Eskiden bu bir birleşim (union) TİPİYDİ ve türlerin tam listesi ikinci bir
 * yerde, `tests/ledger.test.ts` içinde ELLE yazılıydı ("her madde türü bir
 * cümle üretir" testi). Yani yeni bir tür eklendiğinde test onu görmüyordu:
 * cümlesi olmayan bir tür sessizce geçebilirdi. Liste artık dizidir, tip ondan
 * TÜRETİLİR ve test de aynı diziyi okur (kısıt #5).
 *
 * `general_ledger.kind` sütunu serbest metindir (enum kısıtı YOK), dolayısıyla
 * yeni bir tür migration istemez.
 */
export const LEDGER_KINDS = [
  "override",
  "refusal",
  "heeded",
  "starvation",
  "desertion",
  "treasury_drain",
  "fed_people",
  "paid_soldiers",
  "festival",
  "request_met",
  "request_refused",
  // KOALİSYON MASASI (plan belgesi Fikir 8). Elebaşının talebi karşılandı mı,
  // geçiştirildi mi? Bu iki tür, kararın "Kral ısrarla reddederse elebaşı
  // SERTLEŞİR" maddesinin taşıyıcısıdır: sertleşme burada, defterin ARTAN
  // AĞIRLIK deseninde yaşıyor (bkz. `phraseFor`).
  "faction_settled",
  "faction_defied",
] as const;

export type LedgerKind = typeof LEDGER_KINDS[number];

export type LedgerEntry = {
  kind: LedgerKind;
  /** Kaç kez yaşandı; aynı türden olaylar tek maddede toplanır. */
  weight: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

/** Deftere sığdırılacak en fazla madde. Bağlam şişmesin diye dar tutuldu. */
export const LEDGER_LIMIT = 20;

/**
 * Aynı türden bir olayın yeniden deftere düşmesi için geçmesi gereken süre.
 * Halk açken her mesajda "yine aç bıraktınız" saymak, tek bir krizi onlarca
 * suçlamaya çevirirdi; durum temelli maddeler bu pencereyle sönümlenir.
 */
export const RESTATE_WINDOW_MS = 6 * 3_600_000;

/** Durumdan (olaydan değil) türeyen maddeler; tekrar penceresine tabidirler. */
const STATEFUL: ReadonlySet<LedgerKind> = new Set<LedgerKind>([
  "starvation", "desertion", "treasury_drain", "fed_people", "paid_soldiers",
  // Karşılanmayan talep de süregelen bir durumdur: her mesajda yeniden
  // "geçiştirdi" saymak tek bir ihmali onlarca suçlamaya çevirirdi.
  "request_refused",
  // Muhalefetin masa teklifi de öyle: baskı 50'nin üstünde kaldığı sürece
  // talep AÇIK kalır, yani pencere olmasa Kral tek bir konuşmada ağırlığı
  // üçe çıkarabilir ve elebaşı sebepsiz yere en sert diline geçerdi.
  "faction_defied",
]);

const COUNT_WORDS = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz", "on"];

/** "üç kez" gibi; ondan sonrası rakamla. */
export function timesPhrase(weight: number) {
  const n = Math.max(1, Math.floor(weight));
  return `${n <= 10 ? COUNT_WORDS[n] : n} kez`;
}

/**
 * Bir maddenin deftere yazılacak cümlesi. Ağırlık arttıkça dil sertleşir:
 * bir kerelik olay gözlem, tekrar eden olay karakter tespitidir.
 */
export function phraseFor(entry: Pick<LedgerEntry, "kind" | "weight">): string {
  const { kind, weight } = entry;
  const times = timesPhrase(weight);
  switch (kind) {
    case "override":
      return weight >= 3
        ? `Kral itirazımı ${times} ezdi; uyarılarımı ciddiye almama eğiliminde.`
        : `Kral itirazımı ${times} ezip emri yine de uygulattı.`;
    case "refusal":
      return `Bir emri ${times} reddetmek zorunda kaldım.`;
    case "heeded":
      return weight >= 3
        ? `Kral uyarımı ${times} dinleyip riskli emirden vazgeçti; sözüme değer veriyor.`
        : `Kral uyarımı ${times} dinleyip riskli emirden vazgeçti.`;
    case "starvation":
      return weight >= 3
        ? `Halkı ${times} aç bıraktı; ambar yönetimi onun zayıf tarafı.`
        : `Halkın istihkakı ${times} karşılanamadı.`;
    case "desertion":
      return `Maaşsız kalan askerler ${times} firar etti.`;
    case "treasury_drain":
      return weight >= 3
        ? `Hazineyi ${times} son ana kadar boşalttı; rezerv tutma alışkanlığı yok.`
        : `Hazine ${times} tehlikeli biçimde dibe indi.`;
    case "fed_people":
      return weight >= 3
        ? `Halkın karnını doyurmayı ${times} önceledi; bu onun için ilke.`
        : `Halkı ${times} tok tuttu.`;
    case "paid_soldiers":
      return `Askerin maaşını ${times} tam ödedi.`;
    case "festival":
      return `Halk için ${times} şenlik verdi.`;
    case "request_met":
      return weight >= 3
        ? `Benden geleni ${times} karşıladı; taleplerimi dikkate alıyor.`
        : `Talebimi ${times} karşıladı.`;
    case "request_refused":
      return weight >= 3
        ? `Talebimi ${times} geçiştirdi; istediklerim ona ulaşmıyor.`
        : `Talebimi ${times} karşılamadı.`;
    // ELEBAŞININ SERTLEŞMESİ (plan belgesi Fikir 8, "Karar 2026-08-22").
    //
    // Sertleşme buradadır ve `override`/`request_refused` ile BİREBİR aynı
    // desendir: bir kerelik ret bir gözlem, tekrar eden ret bir karakter
    // tespitidir. Kararın "elebaşı sertleşir" cümlesinin kod tabanındaki
    // karşılığı bu artan ağırlıktır — karar zaten `engine/ledger.ts`'in bu
    // desenine işaret ediyor.
    //
    // `faction_defied` ayrıca STATEFUL listesindedir: muhalefet baskısı süregelen
    // bir durumdur ve Kral her mesajında yeniden "geçiştirdi" sayılırsa tek bir
    // ihmal onlarca suçlamaya dönüşür.
    case "faction_settled":
      return weight >= 3
        ? `Muhalefetin elebaşısıyla ${times} pazarlığa oturdu; halkın yükünü hafifletmeyi biliyor.`
        : `Muhalefetin talebini ${times} karşıladı.`;
    case "faction_defied":
      return weight >= 3
        ? `Elebaşının masa teklifini ${times} geçiştirdi; muhalefetin dili her seferinde sertleşiyor ve artık kimse kaleyi dinlemiyor.`
        : `Elebaşının masa teklifini ${times} geçiştirdi.`;
  }
}

/**
 * Olayı deftere işler. Aynı tür varsa ağırlığı artar, yoksa yeni madde açılır.
 * Durum temelli maddeler tekrar penceresi dolmadan yeniden sayılmaz.
 */
export function recordEvent(entries: LedgerEntry[], kind: LedgerKind, at: number): LedgerEntry[] {
  const existing = entries.find(entry => entry.kind === kind);
  if (!existing) return [...entries, { kind, weight: 1, firstSeenAt: at, lastSeenAt: at }];
  if (STATEFUL.has(kind) && at - existing.lastSeenAt < RESTATE_WINDOW_MS) {
    return entries;
  }
  return entries.map(entry =>
    entry.kind === kind ? { ...entry, weight: entry.weight + 1, lastSeenAt: at } : entry,
  );
}

export function recordEvents(entries: LedgerEntry[], kinds: LedgerKind[], at: number): LedgerEntry[] {
  return kinds.reduce((carry, kind) => recordEvent(carry, kind, at), entries);
}

/**
 * Defteri sınıra indirir. Önce ağırlık (tekrar eden davranış kalıcı bilgidir),
 * eşitlikte tazelik korunur; en sönük ve en eski madde düşer.
 */
export function pruneLedger(entries: LedgerEntry[], limit = LEDGER_LIMIT): LedgerEntry[] {
  if (entries.length <= limit) return entries;
  return [...entries]
    .sort((a, b) => b.weight - a.weight || b.lastSeenAt - a.lastSeenAt)
    .slice(0, limit);
}

/**
 * Defteri modele verilecek kısa metne çevirir. En taze maddeler önce gelir;
 * sayı ve cümleler kısadır çünkü bu metin HER istekte bağlama giriyor.
 */
export function renderLedger(entries: LedgerEntry[], now: number): string {
  if (!entries.length) return "";
  const lines = [...entries]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map(entry => `- ${phraseFor(entry)}${agePhrase(entry.lastSeenAt, now)}`);
  return lines.join("\n");
}

function agePhrase(at: number, now: number) {
  const hours = Math.floor((now - at) / 3_600_000);
  if (hours < 1) return "";
  if (hours < 24) return ` (${hours} saat önce)`;
  return ` (${Math.floor(hours / 24)} gün önce)`;
}

/** Bir turdan defter olayı çıkarmak için gereken özet. */
export type LedgerSignals = {
  resources: Record<string, number>;
  hourlyRates: Record<string, number>;
  populace?: {
    moodScore?: number;
    foodRation?: number;
    soldierPay?: number;
    soldierUnrest?: number;
    army?: number;
  };
  /** Motora iletilen (onaylanmış) eylem adları. */
  appliedActions: string[];
  /** Kral General'in itirazını ezerek emri uygulattı mı? */
  kingOverrode: boolean;
  /** General bu turda bir emri reddetti mi? */
  generalRefused: boolean;
  /** Kral bekleyen riskli emirden vazgeçti mi? */
  kingBackedDown: boolean;
  /** Bu turda karşılanan / geçiştirilen General talebi sayısı. */
  requestsMet: number;
  requestsRefused: number;
  /**
   * KOALİSYON MASASI (plan belgesi Fikir 8) — elebaşının açık talebi bu turda
   * karşılandı mı, geçiştirildi mi?
   *
   * Sayı değil BAYRAK, çünkü aynı anda tek bir masa vardır (tek bir elebaşı,
   * tek bir `muhalefet` talebi). İkisi de opsiyonel: masa girdisi olmayan
   * çağıran için hiçbir defter satırı açılmaz.
   */
  factionSettled?: boolean;
  factionDefied?: boolean;
};

const TREASURY_FLOOR = 60;
const DESERTION_UNREST = 60;

/**
 * Turun defterlik olaylarını çıkarır. Saf: yalnızca özetten karar verir,
 * mükerrer yazımı `recordEvent` penceresi engeller.
 */
export function deriveLedgerEvents(signals: LedgerSignals): LedgerKind[] {
  const kinds: LedgerKind[] = [];
  const populace = signals.populace ?? {};

  if (signals.kingOverrode) kinds.push("override");
  if (signals.generalRefused) kinds.push("refusal");
  if (signals.kingBackedDown) kinds.push("heeded");
  for (let i = 0; i < signals.requestsMet; i += 1) kinds.push("request_met");
  for (let i = 0; i < signals.requestsRefused; i += 1) kinds.push("request_refused");
  if (signals.appliedActions.includes("host_festival")) kinds.push("festival");
  // Koalisyon masası: karşılama ve geçiştirme birbirini DIŞLAR — Kral aynı
  // turda hem pazarlığa oturup hem geçiştirmiş olamaz. Karşılama önce sınanır
  // ki sınırdaki bir tur Kral'ın aleyhine yazılmasın.
  if (signals.factionSettled) kinds.push("faction_settled");
  else if (signals.factionDefied) kinds.push("faction_defied");

  // Halkın karnı: istihkak fiilen düşükse ya da yiyecek tükeniyorsa açlık,
  // istihkak tamsa ve stok erimiyorsa tokluk deftere geçer.
  const ration = populace.foodRation ?? 100;
  const foodRate = signals.hourlyRates.food ?? 0;
  const food = signals.resources.food ?? 0;
  const starving = ration < 60 || (foodRate < 0 && food / Math.abs(foodRate) <= 6);
  if (starving) kinds.push("starvation");
  else if (ration >= 100 && foodRate >= 0) kinds.push("fed_people");

  // Ordu: maaş kesildiyse ve huzursuzluk firar eşiğini geçtiyse defterlik.
  const army = populace.army ?? 0;
  if (army > 0) {
    if ((populace.soldierUnrest ?? 0) >= DESERTION_UNREST) kinds.push("desertion");
    else if ((populace.soldierPay ?? 100) >= 100) kinds.push("paid_soldiers");
  }

  if ((signals.resources.gold ?? 0) < TREASURY_FLOOR) kinds.push("treasury_drain");

  return kinds;
}
