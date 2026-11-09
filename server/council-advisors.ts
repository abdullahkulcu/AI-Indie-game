import { SOLDIER_THRESHOLDS } from "../engine/populace";
import { VOICE_THRESHOLDS } from "../engine/populace-voice";
import { aiGuidedSystemPrompt } from "./ai-guides";

export type CouncilRole = "general" | "commons" | "garrison";
export type CouncilPriority = "steady" | "watch" | "urgent";

export type CouncilConnection = {
  role: CouncilRole;
  label: string;
  state: "connected" | "fallback" | "error";
  provider?: string;
  model?: string;
  detail?: string;
  source: "player" | "channel" | "kingdom" | "rules";
};

export type CouncilVoice = {
  role: CouncilRole;
  speaker: string;
  text: string;
  priority: CouncilPriority;
  mode: "ai" | "rules";
};

export type CouncilSnapshot = {
  popularity?: number;
  taxRate?: number;
  population?: number;
  resources?: Record<string, number>;
  hourlyRates?: Record<string, number>;
  strategyNote?: string;
  protectionHoursLeft?: number;
  activeConstruction?: { name?: string; secondsRemaining?: number } | null;
  worldEvent?: {
    phase: "active" | "warning";
    label: string;
    tone: "favorable" | "adverse";
    summary: string;
    advice: string;
    startsAt: number;
    endsAt: number | null;
  };
  populace?: {
    mood?: string;
    servedFood?: number;
    livingCost?: number;
    capacity?: number;
    army?: number;
    soldierUnrest?: number;
    soldierPay?: number;
  };
  defense?: {
    watchRatio?: number;
    power?: number;
    recentRaids?: Array<{ text?: string; hoursAgo?: number }>;
  };
};

type PublicCue = { id: string; priority: CouncilPriority; fallback: string; instruction: string };

const number = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Halk ve Garnizon AI'larına iç rakamlar değil yalnızca nitel durum gider. */
export function publicCouncilCues(snapshot: CouncilSnapshot): { commons: PublicCue; garrison: PublicCue } {
  const populace = snapshot.populace ?? {};
  const food = number(populace.servedFood, 100);
  const living = number(populace.livingCost, 1);
  const popularity = number(snapshot.popularity);
  const tax = number(snapshot.taxRate);
  const population = Math.max(0, number(snapshot.population));
  const capacity = Math.max(0, number(populace.capacity));
  const occupancy = capacity > 0 ? population / capacity : 0;
  const army = Math.max(0, number(populace.army));
  const unrest = Math.max(0, number(populace.soldierUnrest));
  const pay = number(populace.soldierPay, 100);
  const watch = number(snapshot.defense?.watchRatio, 50);
  const raids = snapshot.defense?.recentRaids?.length ?? 0;

  let commons: PublicCue;
  if (food < VOICE_THRESHOLDS.bread.urgent) commons = {
    id: "bread-urgent", priority: "urgent",
    fallback: "Sofralar boşalıyor; halk her karardan önce ekmek payının düzelmesini bekliyor.",
    instruction: "Sofralar boşalıyor. Kraldan öncelikle ekmek payını düzeltmesini iste.",
  };
  else if (food < VOICE_THRESHOLDS.bread.ration) commons = {
    id: "bread-watch", priority: "watch",
    fallback: "Paylar daraldı; halk ambar büyürken kendi sofrasının küçülmesini istemiyor.",
    instruction: "Yiyecek payı yetersizleşiyor. Ölçülü ama açık biçimde tam pay iste.",
  };
  else if (living > VOICE_THRESHOLDS.price.index) commons = {
    id: "price", priority: living > VOICE_THRESHOLDS.price.urgent ? "urgent" : "watch",
    fallback: "Çarşı pahalılaştı; ambar dolu olsa bile halk pazardaki geçim yükünü hissediyor.",
    instruction: "Çarşıdaki geçim yükü ağırlaştı. Kraldan pazar ve istihkak dengesine bakmasını iste.",
  };
  else if (tax > VOICE_THRESHOLDS.tax.rate && popularity < VOICE_THRESHOLDS.tax.mood) commons = {
    id: "tax", priority: popularity < VOICE_THRESHOLDS.tax.urgent ? "urgent" : "watch",
    fallback: "Vergi yükü rızayı aşındırıyor; halk hazinenin ağırlığını tek başına taşımak istemiyor.",
    instruction: "Vergi yükü rızayı aşındırıyor. Kraldan yükü hafifletmesini iste.",
  };
  else if (occupancy > VOICE_THRESHOLDS.roof.occupancy) commons = {
    id: "roof", priority: occupancy >= VOICE_THRESHOLDS.roof.urgent ? "urgent" : "watch",
    fallback: "Evler doldu; halk yeni aileler çağrılmadan önce barınacak yer açılmasını bekliyor.",
    instruction: "Konutlar dolu. Kraldan yeni barınma alanı açmasını iste.",
  };
  else if (popularity < VOICE_THRESHOLDS.joy.mood) commons = {
    id: "mood", priority: popularity < VOICE_THRESHOLDS.joy.urgent ? "urgent" : "watch",
    fallback: "Karınlar tok olsa da gönüller kırgın; halk kendisini yalnızca bir üretim kalemi gibi görmek istemiyor.",
    instruction: "Halkın rızası düşük. Kraldan gündelik hayatı ve ortak morali gözetmesini iste.",
  };
  else commons = {
    id: "content", priority: "steady",
    fallback: "Halkın bugün açık bir şikâyeti yok; düzen sürerse üretim ve nüfus güvenle büyüyebilir.",
    instruction: "Halkın açık bir şikâyeti yok. Kralın dengeli yönetimini kısa ve ölçülü biçimde teyit et.",
  };

  let garrison: PublicCue;
  if (army <= 0) garrison = {
    id: "no-army", priority: "watch",
    fallback: "Sancakta düzenli birlik yok; surlar var ama onları tutacak eğitimli asker henüz bulunmuyor.",
    instruction: "Düzenli birlik olmadığını, savunmanın yalnız surlara bırakılamayacağını söyle.",
  };
  else if (unrest >= SOLDIER_THRESHOLDS.desertion) garrison = {
    id: "desertion", priority: "urgent",
    fallback: "Kışlada disiplin çözülüyor; yeni emirlerden önce maaş ve güven yeniden kurulmalı.",
    instruction: "Kışlada firar ve disiplin çözülmesi riski var. Maaş ve güveni birinci öncelik yap.",
  };
  else if (unrest >= SOLDIER_THRESHOLDS.demand || pay < 100) garrison = {
    id: "pay", priority: "watch",
    fallback: "Asker emre hazır, fakat eksik maaş uzarsa sadakat ve eğitim düzeni bozulacak.",
    instruction: "Maaş ve huzursuzluk kışlayı zorluyor. Sert ama ölçülü biçimde maaş düzeni iste.",
  };
  else if (raids > 0 || watch < 30) garrison = {
    id: "watch", priority: watch < 30 ? "urgent" : "watch",
    fallback: "Sınır nöbeti gevşetilmemeli; son tehditler kalenin hazırlığını sınamaya devam ediyor.",
    instruction: "Sınır güvenliğinin ve nöbet düzeninin korunmasını iste.",
  };
  else garrison = {
    id: "ready", priority: "steady",
    fallback: "Kışla sakin, maaş defteri düzenli; garnizon savunma ve eğitim emirlerine hazır.",
    instruction: "Kışlanın sakin ve emre hazır olduğunu, disiplinin korunması gerektiğini söyle.",
  };
  return { commons, garrison };
}

const PUBLIC_SYSTEM: Record<"commons" | "garrison", string> = {
  commons: "Sen Demirkale oyununda halk meclisinin bağımsız sesisin. Kralın karşısında halkın çıkarını savun. General gibi konuşma, emir uygulama ve yeni olay uydurma. Birinci çoğul şahısla doğal Türkçe kullan. En fazla iki kısa, TAM cümle yaz; başlık, liste, sayı, yüzde ve özel isim kullanma.",
  garrison: "Sen Demirkale oyununda garnizonun bağımsız askeri sesisin. Kralın karşısında kışlanın güvenlik, maaş ve disiplin çıkarını savun. General değilsin ve emir uygulamazsın. Birinci çoğul şahısla kısa, ölçülü ve askeri Türkçe kullan. En fazla iki kısa, TAM cümle yaz; başlık, liste, sayı, yüzde ve özel isim kullanma.",
};

export function publicAdvisorPrompt(role: "commons" | "garrison", cue: PublicCue) {
  return { system: aiGuidedSystemPrompt(role, PUBLIC_SYSTEM[role]), user: `DİVAN KONUSU: ${cue.instruction}\nYalnızca bu durum hakkında kendi görüşünü söyle.` };
}

export function generalCouncilPrompt(snapshot: CouncilSnapshot) {
  const compact = {
    popularity: number(snapshot.popularity), taxRate: number(snapshot.taxRate), population: number(snapshot.population),
    resources: snapshot.resources ?? {}, hourlyRates: snapshot.hourlyRates ?? {},
    strategyNote: String(snapshot.strategyNote ?? ""), protectionHoursLeft: number(snapshot.protectionHoursLeft),
    activeConstruction: snapshot.activeConstruction ?? null, worldEvent: snapshot.worldEvent ?? null, populace: snapshot.populace ?? {}, defense: snapshot.defense ?? {},
  };
  return {
    system: aiGuidedSystemPrompt("general", "Sen Demirkale oyununda Kralın özerk Generalisin. Divan için yalnızca mevcut krallık durumundan stratejik görüş çıkar. Halkın ya da garnizonun ağzından konuşma; onların çıkarlarını hesaba kat fakat komutan bakışını koru. Emir uygulama ve araç çağırma. En önemli fırsat veya riski en fazla iki kısa, TAM Türkçe cümlede söyle; başlık, Markdown ve liste kullanma."),
    user: `KRALLIK_DURUMU=${JSON.stringify(compact)}\nDivanda Kralın önüne getireceğin en önemli görüş nedir?`,
  };
}

export function fallbackGeneralThought(snapshot: CouncilSnapshot): { text: string; priority: CouncilPriority } {
  const foodRate = number(snapshot.hourlyRates?.food);
  const army = number(snapshot.populace?.army);
  const protection = number(snapshot.protectionHoursLeft);
  const worldEvent = snapshot.worldEvent;
  if (worldEvent?.phase === "warning" && worldEvent.tone === "adverse") return { text: `${worldEvent.label} yaklaşırken ${worldEvent.advice.charAt(0).toLocaleLowerCase("tr-TR")}${worldEvent.advice.slice(1)}`, priority: "watch" };
  if (worldEvent?.phase === "active" && worldEvent.tone === "adverse") return { text: `${worldEvent.label} sürüyor; ${worldEvent.advice.charAt(0).toLocaleLowerCase("tr-TR")}${worldEvent.advice.slice(1)}`, priority: "urgent" };
  if (foodRate < 0) return { text: "Yiyecek dengesi açık veriyor; yeni yükümlülük almadan önce üretim ve istihkakı aynı kararda dengelemeliyiz.", priority: "urgent" };
  if (army <= 0 && protection <= 0) return { text: "Kuruluş koruması sona ermişken düzenli birlik bulunmaması, ekonomik büyümeyi savunmasız bırakıyor.", priority: "watch" };
  if (snapshot.activeConstruction) return { text: "Mevcut inşaat tamamlanana kadar kaynakları ikinci bir büyük taahhüde bağlamamak en güvenli hareket alanını korur.", priority: "steady" };
  return { text: "Krallık bugün dengede; bir sonraki karar kısa vadeli kazançtan çok üretim, rıza ve savunmayı birlikte büyütmeli.", priority: "steady" };
}

export function sanitizeCouncilThought(raw: string | null | undefined) {
  const printable = Array.from(String(raw ?? ""), character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  const cleaned = printable
    .replace(/[`*_#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
  // Sağlayıcı token tavanına çarparsa yarım fikri Kralın önüne koymuyoruz.
  // Son tam cümle yoksa çağıran deterministik görüşe düşer.
  const end = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf("!"), cleaned.lastIndexOf("?"));
  return end >= 0 ? cleaned.slice(0, end + 1).trim() : "";
}

/** Eski önbelleklerdeki yarım model yanıtlarını da Kralın önüne çıkarmaz. */
export function completedCouncilVoices(voices: CouncilVoice[]): CouncilVoice[] {
  return voices.flatMap(voice => {
    const text = sanitizeCouncilThought(voice.text);
    return text ? [{ ...voice, text }] : [];
  });
}

export function fallbackVoice(role: CouncilRole, snapshot: CouncilSnapshot): CouncilVoice {
  if (role === "general") {
    const fallback = fallbackGeneralThought(snapshot);
    return { role, speaker: "GENERAL", text: fallback.text, priority: fallback.priority, mode: "rules" };
  }
  const cue = publicCouncilCues(snapshot)[role];
  return { role, speaker: role === "commons" ? "HALK MECLİSİ" : "GARNİZON", text: cue.fallback, priority: cue.priority, mode: "rules" };
}
