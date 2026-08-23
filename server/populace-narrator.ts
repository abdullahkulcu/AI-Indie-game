import {
  DEMAND_SUBJECT, type DemandCandidate, type DemandKind, type DemandSeverity, type DemandTone,
  demandTone,
} from "../engine/populace-voice";
import { type PopulacePersona, populacePersonaProfile } from "../engine/populace-persona";
import { POPULACE_TEXT_LIMIT, sanitizeDemandText } from "./populace-brief";
import { callProviderText } from "./llm-provider";
import type { ResolvedPopulaceCredential } from "./populace-ai-credentials";

/**
 * HALKIN SESİNİN ANLATIM KATMANI (plan belgesi Fikir 2).
 *
 * İŞ BÖLÜMÜ — bu dosyanın tek gerekçesi: TETİKLEYİCİ ile CÜMLE ayrıldı.
 *  - `engine/populace-voice.ts` bir talebin ne zaman açılıp kapandığına karar
 *    verir. Saf, deterministik, LLM'den habersiz; oyun dengesi orada yaşar.
 *  - Bu dosya yalnızca o talebin Kral'a hangi CÜMLEYLE görüneceğini üretir.
 *    Model çağrısı burada olur, `syncPopulaceDemands` içinde değil: kalıcılık
 *    modülü veritabanı defteri tutar, sağlayıcıya gitmez.
 *
 * Bu dosya VERİTABANINA DOKUNMAZ ve saati dışarıdan alır. Sebebi
 * `server/populace-ai-credentials.ts` ile aynı: `../db` (dolayısıyla
 * `cloudflare:workers`) import edilseydi "kimlik bilgisi yoksa şablona düşülür"
 * ve "model hata verirse talep gizlenir" kurallarının testten çağrılabilir tek
 * bir sınaması olmazdı. Satırlar ve yazma işleri çağıranda kalır.
 */

/** Model çağrısına verilen tavan; tek cümle için fazlasıyla yeterli. */
const NARRATOR_MAX_TOKENS = 160;

/**
 * Halk-AI'ya verilen talimat.
 *
 * PROMPT'A NE GİRMEZ: krallığın iç verisi (ambar, istihkak yüzdesi, vergi
 * oranı, huzursuzluk puanı, nüfus), komşuların kimliği ya da rakamları, Kral'ın
 * ya da krallığın adı. Halk-AI kimlik bilgisi OYUN KURUCUSUNUN anahtarıdır
 * (bkz. `server/populace-ai-credentials.ts`); oraya oyuncunun iç verisini
 * göndermek plan belgesinin §2'deki bilgi asimetrisi sınırını halkın sesi
 * üzerinden aşmak olurdu. Modele verilen tek şey: kim konuşuyor, konu ne, ne
 * kadar acil ve dil hangi kademede.
 *
 * SAYI YASAĞI ayrıca metin kalitesi için de gerekli: modele sayı verilmediği
 * hâlde sayı uydurabilir ("istihkak %30'a indi"), ve Kral panelde başka bir
 * rakam görürse halkın sesi güvenilmez hâle gelir. Bu yüzden yasak prompt'ta
 * açıkça yazılı.
 */
const NARRATOR_PROMPT = [
  "Sen Demirkale adlı ortaçağ krallık oyununda bir sancağın HALKISIN. Kral'a tek bir cümleyle sesleniyorsun.",
  "Sana verilen konuyu kendi ağzınla söyle. Yeni bir talep uydurma, verilen konudan başka bir şey isteme.",
  `TEK cümle yaz. En fazla ${POPULACE_TEXT_LIMIT} karakter. Başlık, madde imi, tırnak, emoji ve selam yok.`,
  "HİÇBİR SAYI ya da yüzde yazma; rakam uydurmak yasak. Krallığın, Kral'ın, komşu sancakların ya da kişilerin adını da yazma.",
  "Üçüncü tekil şahısla 'halk şunu istiyor' diye anlatma; halkın kendi ağzından, birinci çoğul şahısla konuş.",
  "Örgütlü hoşnutsuzluktan söz edeceksen 'muhalefet' de; 'hizip' demeyi bırak.",
  "Yalnızca cümleyi yaz; açıklama, gerekçe ya da ek satır ekleme.",
].join("\n");

/** Kademelerin modele verilen karşılığı; kademeyi MOTOR seçer, model uygular. */
const TONE_INSTRUCTION: Record<DemandTone, string> = {
  ilk: "Bunu Kral'a İLK KEZ söylüyorsun: ölçülü bir dilek, saygılı bir rica.",
  israr: "Bunu daha önce söyledin ve karşılık gelmedi: sitem var, hatırlatma var, sabır azalıyor.",
  ofke: "Uzun süredir cevap alamadın: açıkça kızgınsın, sesin yüksek, muhalefetin dilini ödünç alıyorsun.",
};

/** Kim konuşuyor; garnizonun dili halkın dili değildir. */
const VOICE_INSTRUCTION: Record<DemandCandidate["voice"], string> = {
  commons: "Konuşan halktır: çarşı, tarla ve evler.",
  garrison: "Konuşan kışladaki askerdir: halk değil, silah altındaki adamlar. Asker dili daha kısa ve daha sert olur.",
};

/**
 * Talebin modele verilen yüzü — sayı YOK, isim YOK.
 *
 * Kişilik BU YAPIDA DEĞİL ve bu bilinçli: kişilik kimlik bilgisinin bir parçası
 * (`server/populace-ai-credentials.ts`), yani "hangi channel hangi tonla
 * konuşur" sorusunun cevabı. Çağıranın onu bilmesi ya da geçmesi gerekmez;
 * `populaceNarrator` kendi kapanışından ekler. Aksi hâlde her çağıran kişiliği
 * kendi başına okurdu ve öncelik sırası ikinci bir yere kopyalanırdı.
 */
export type DemandVoiceCue = {
  kind: DemandKind;
  voice: DemandCandidate["voice"];
  severity: DemandSeverity;
  tone: DemandTone;
};

export type NarrationRequest = DemandVoiceCue & { persona: PopulacePersona };

/** Modele gidecek kullanıcı mesajı. Ayrı fonksiyon: testte doğrudan ölçülür. */
export function narrationPrompt(request: NarrationRequest): string {
  const persona = populacePersonaProfile(request.persona);
  return [
    `HALKIN HUYU: ${persona?.tone ?? ""}`,
    VOICE_INSTRUCTION[request.voice],
    `KONU: ${DEMAND_SUBJECT[request.kind]}`,
    request.severity === "urgent"
      ? "DURUM ACİL: iş çığırından çıkmak üzere, bunu cümlede hissettir."
      : "DURUM ACİL DEĞİL: sıkıntı var ama felaket yok.",
    `DİLİN KADEMESİ: ${TONE_INSTRUCTION[request.tone]}`,
    "Şimdi o tek cümleyi yaz.",
  ].join("\n");
}

/**
 * Bir talebin cümlesini üretir. Başarısızlıkta `null`.
 *
 * Hata YUTULUR ve loglanmaz: mesaj sağlayıcının gövdesini, o da bazı
 * sağlayıcılarda isteğin başlığını yankılayabilir (kısıt #4). Çağıran için
 * "null" ile "sağlayıcı 500 verdi" arasında fark yok; ikisinde de karar aynı.
 */
export type DemandNarrator = (cue: DemandVoiceCue) => Promise<string | null>;

export function populaceNarrator(credential: ResolvedPopulaceCredential): DemandNarrator {
  return async (cue) => {
    try {
      const text = await callProviderText({
        provider: credential.provider,
        model: credential.model,
        apiKey: credential.apiKey,
        system: NARRATOR_PROMPT,
        user: narrationPrompt({ ...cue, persona: credential.persona }),
        maxTokens: NARRATOR_MAX_TOKENS,
        // Halkın sesi her seferinde birebir aynı cümle olmasın. Kademe
        // değişmedikçe metin zaten yeniden üretilmediği için bu sıcaklık
        // Kral'ın gözünde tutarsızlık yaratmaz.
        temperature: 0.8,
      });
      const clean = text ? sanitizeDemandText(text) : "";
      // Tek kelimelik ya da temizlemeden sonra boşalmış cevap "model konuşmadı"
      // sayılır; yarım bir cümleyi Kral'a halkın sesi diye göstermeyiz.
      return clean.length >= 8 ? clean : null;
    } catch {
      return null;
    }
  };
}

/** Defterdeki satırın anlatım için gereken kadarı. */
export type StoredNarration = { kind: DemandKind; text: string; tone: DemandTone | null };

/** Kral'a gösterilecek talep; `store` true ise satıra yeni metin yazılacak. */
export type NarratedDemand = {
  kind: DemandKind;
  voice: DemandCandidate["voice"];
  severity: DemandSeverity;
  text: string;
  /** Metnin üretildiği kademe; `null` = deterministik şablon metin. */
  tone: DemandTone | null;
  store: boolean;
};

/**
 * "Bu turda hangi talep hangi cümleyle görünür?" — kararın TEK yeri.
 *
 * ÜÇ YOL var ve üçü de plan belgesindeki karara birebir bağlı:
 *
 *  1) HALK-AI YOK (`narrate === null`): bugünkü deterministik şablon metin
 *     kullanılır ve talep normal biçimde görünür. Özellik KADEMELİ açılır —
 *     oyun kurucusu bir channel'a anahtar girmediyse o channel hiçbir şey
 *     kaybetmez. (Fikir 0'ın "Halk-AI yok, deterministik davran" sözleşmesi.)
 *
 *  2) HALK-AI VAR, kademe değişmemiş: satırdaki cümle AYNEN kullanılır, model
 *     çağrılmaz. Maliyet disiplini `server/general-ledger.ts`'in "değişmeyen
 *     satıra yazma" deseniyle aynı; ayrıca Kral aynı talebi her mesajda başka
 *     kelimelerle görmez.
 *
 *  3) HALK-AI VAR, kademe değişmiş (ya da hiç cümle yok): model çağrılır.
 *     - Başarılıysa yeni cümle gösterilir ve satıra yazılır.
 *     - BAŞARISIZSA talep ŞABLONA DÜŞMEZ. Karar bu: şablon cümle Halk-AI'sı
 *       olan bir channel'da halkın sesini bir anda robotlaştırır ve Kral
 *       sebebini göremez.
 *       GÜVENLİK AĞI: satırda Halk-AI'nın DAHA ÖNCE ürettiği bir cümle varsa
 *       (`tone !== null`) o cümle gösterilir. Plan belgesi bu ağı açıkça
 *       öneriyor ("son bilinen metni göster") ve bedeli çok küçük: Kral bir
 *       kademe daha yumuşak bir cümle görür, ama ACİL bir talebi (ör. `wage`)
 *       yalnızca sağlayıcı hatası yüzünden KAÇIRMAZ. Ağ olmasaydı geçici bir
 *       502, firar başlamış bir garnizonu Kral'ın gözünden tamamen silerdi.
 *     - Ağ da yoksa (talep ilk kez açılıyor ve model konuşamadı) talep BU
 *       TURDA GÖSTERİLMEZ. Sonraki istekte yeniden denenir; defterdeki süre
 *       saymaya devam eder, yani talep kaybolmaz, yalnızca sesi gecikir.
 *
 * Talebin AÇILIP AÇILMADIĞI bu fonksiyonun işi DEĞİL; buraya yalnızca süre
 * şartını geçmiş talepler gelir. Model hatası bir talebi ne açar ne kapatır.
 */
export async function narrateDemands(input: {
  open: DemandCandidate[];
  stored: readonly StoredNarration[];
  heldGameHours: Partial<Record<DemandKind, number>>;
  narrate: DemandNarrator | null;
}): Promise<NarratedDemand[]> {
  const stored = new Map(input.stored.map(row => [row.kind, row]));
  const out: NarratedDemand[] = [];
  for (const demand of input.open) {
    const row = stored.get(demand.kind);
    if (!input.narrate) {
      // Şablon metin motordan gelir; buradan geçerken değişmez.
      out.push({ kind: demand.kind, voice: demand.voice, severity: demand.severity, text: demand.text, tone: null, store: true });
      continue;
    }
    const tone = demandTone(demand.severity, input.heldGameHours[demand.kind] ?? 0);
    if (row?.tone === tone && row.text) {
      out.push({ kind: demand.kind, voice: demand.voice, severity: demand.severity, text: row.text, tone, store: false });
      continue;
    }
    const fresh = await input.narrate({ kind: demand.kind, voice: demand.voice, severity: demand.severity, tone });
    if (fresh) {
      out.push({ kind: demand.kind, voice: demand.voice, severity: demand.severity, text: fresh, tone, store: true });
      continue;
    }
    // Güvenlik ağı: yalnızca Halk-AI'nın kendi ürettiği son cümle (tone dolu).
    // Şablon metin (tone === null) bilinçli olarak KABUL EDİLMEZ.
    if (row?.tone && row.text) {
      out.push({ kind: demand.kind, voice: demand.voice, severity: demand.severity, text: row.text, tone: row.tone, store: false });
    }
  }
  return out;
}
