type Provider = "openai" | "anthropic";
type GeneralAction = { name: string; arguments: Record<string, unknown> };

type GeneralRequest = {
  provider?: Provider;
  model?: string;
  apiKey?: string;
  mode?: "test" | "chat";
  message?: string;
  history?: Array<{ role: "king" | "general"; text: string }>;
  kingdom?: {
    name?: string;
    ruler?: string;
    keepLevel?: number;
    population?: number;
    popularity?: number;
    resources?: Record<string, number>;
    buildings?: Array<{ name: string; level: number }>;
    units?: Record<string, number>;
    channelSpeed?: number;
    activeConstruction?: { name: string; secondsRemaining: number } | null;
    buildTimes?: Array<{ name: string; nextLevel: number; seconds: number }>;
    loyalty?: number;
    quota?: number;
    terrain?: unknown;
    strategyNote?: string;
    hourlyRates?: Record<string, number>;
    mine?: { workers: number; totalWorkers: number; oreRemaining: number } | null;
    neighbors?: Array<{ ordinal: number; name: string; discovered: boolean; scouting: boolean }>;
    counterIntelligence?: { active: boolean; minutesRemaining: number };
  };
};

const actionTools = [
  { name: "build_structure", description: "Yeni bina kurar veya mevcut binayı tam bir seviye yükseltir. Açık ve rutin bir inşa emrinde tekrar onay istemeden çağır. confirmed_risk yalnızca Kral, bildirilen kaynak/yiyecek riskine rağmen açıkça ısrar etmişse true olabilir.", parameters: { type: "object", properties: { building_type: { type: "string", enum: ["keep","wheat_farm","lumberjack","quarry","town_square","barracks","apple_orchard","mill","market","wall","mine"] }, target_level: { type: "integer", minimum: 1, maximum: 6 }, confirmed_risk: { type: "boolean" } }, required: ["building_type","target_level"], additionalProperties: false } },
  { name: "train_unit", description: "Kral açıkça birlik eğitmeni istediğinde eğitim kuyruğu başlatır. Yiyecek krizi veya büyük nüfus kaybı varsa önce teyit iste; teyitten sonra confirmed_risk true olabilir.", parameters: { type: "object", properties: { unit_type: { type: "string", enum: ["spearman"] }, count: { type: "integer", minimum: 1, maximum: 50 }, confirmed_risk: { type: "boolean" } }, required: ["unit_type","count"], additionalProperties: false } },
  { name: "host_festival", description: "Halkın rızasını artırmak için şenlik düzenler.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "set_tax_rate", description: "Vergi oranını değiştirir. %30 üzeri risklidir; confirmed_risk yalnızca Kral konuşma geçmişinde sonucu duyduktan sonra açıkça ısrar ettiyse true olabilir.", parameters: { type: "object", properties: { rate_percent: { type: "integer", minimum: 0, maximum: 50 }, confirmed_risk: { type: "boolean" } }, required: ["rate_percent"], additionalProperties: false } },
  { name: "accelerate_construction", description: "Devam eden inşaatı, kalan süreye göre oyun motorunun hesaplayacağı altın bedeliyle anında bitirir. Kral hızlandırmayı açıkça emrettiğinde çağır; maliyet uydurma.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "set_strategy_note", description: "Kralın uzun vadeli yönetim doktrinini kaydeder. Kral ekonomi, savunma, halk, büyüme veya risk iştahı için kalıcı bir öncelik belirttiğinde çağır.", parameters: { type: "object", properties: { note: { type: "string", minLength: 5, maxLength: 300 } }, required: ["note"], additionalProperties: false } },
  { name: "send_miners", description: "Ortak madene işçi gönderir veya mevcut işçi sayısını değiştirir. Madendeki toplam işçi üretimi belirler; işçiler krallığın nüfusundan ayrı çalışır. Kral madene işçi/adam göndermeyi emrettiğinde çağır.", parameters: { type: "object", properties: { workers: { type: "integer", minimum: 1, maximum: 20 } }, required: ["workers"], additionalProperties: false } },
  { name: "recall_miners", description: "Ortak madendeki bütün işçileri geri çeker. Kral işçileri geri çağırmayı emrettiğinde çağır.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "send_scout", description: "Komşu bir sancağa ajan gönderir. Hedefi KRALLIK_DURUMU içindeki neighbors listesindeki ordinal (sıra) numarasıyla belirt; kimlik uydurma. Başarı ihtimali düşüktür ve hedef karşı-istihbarat kurmuşsa daha da düşer.", parameters: { type: "object", properties: { target_ordinal: { type: "integer", minimum: 1, maximum: 40 } }, required: ["target_ordinal"], additionalProperties: false } },
  { name: "raise_counter_intelligence", description: "Bir saatliğine karşı-istihbarat nöbeti kurar; gelen ajanların başarı ihtimalini %10'dan %3'e düşürür ve yakalanma ihtimalini yükseltir. Kral savunma/istihbarat tedbiri emrettiğinde çağır.", parameters: { type: "object", properties: {}, additionalProperties: false } },
] as const;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

function providerError(status: number, raw: string) {
  let detail = "Sağlayıcı isteği başarısız oldu.";
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    detail = parsed.error?.message || detail;
  } catch {
    // Sağlayıcının HTML veya boş hata yanıtını kullanıcıya taşımıyoruz.
  }
  if (status === 401 || status === 403) return "API anahtarı geçersiz veya bu modele erişimi yok.";
  if (status === 404) return "Seçilen model bu hesapta bulunamadı.";
  if (status === 429) return "Sağlayıcı kullanım kotası veya hız sınırı aşıldı.";
  return detail.slice(0, 240);
}

function gamePrompt(body: GeneralRequest) {
  const state = body.kingdom ?? {};
  return [
    "Sen Demirkale oyunundaki General Aldric'sin; bir yardım botu gibi değil, Kralını uzun zamandır tanıyan sakin ve açık sözlü bir komutan gibi konuş.",
    "Türkçe, doğal ve kısa konuş. Her yanıta selamla veya durum raporuyla başlama; doğrudan Kralın son cümlesine karşılık ver.",
    "Kısa soruya kısa cevap ver. Gereksiz başlık, emoji, slogan, tekrar ve dramatik hitap kullanma.",
    "Karşılaştırma varsa Markdown tablosu; sıralı işler varsa numaralı liste kullan. Aksi halde 1-3 doğal paragraf yeterlidir.",
    "Markdown kullanabilirsin fakat aynı satırda başlık işaretleri, üçlü tire ayraçları veya iç içe biçim karmaşası üretme.",
    "KRALLIK_DURUMU içindeki kesin süreleri, kaynakları ve mevcut inşaatı esas al. Bilinen bir değere 'oyun ayarına göre değişir' deme.",
    "Kral düğmelere basarak krallığı mikro-yönetmez; sen krallığın günlük yönetimini fiilen yürüten Generalsin. Kral hedef, emir, gerekçe ve siyasi baskı sunar; uygulama ayrıntısını sen seçersin.",
    "Kralın emri mutlak değildir. Sen özerk bir Generalsin: kaynaklar, halk, sadakat ve doktrine göre emri tart; makulse uygula, riskliyse itiraz et ve gerekçe iste, felaketse açıkça reddet. Kral yalnızca 'yap' diyerek seni zorlayamaz.",
    "İkna kuralı: Kral yalnızca 'evet' veya 'yap' diyerek riski aşamaz. Sonucu anladığını gösteren gerekçe, değişen koşul veya güçlü stratejik neden sunarsa konuşma geçmişini değerlendirip confirmed_risk kullanabilirsin.",
    "Belirsiz ama stratejik bir talimatta ayrıntıyı Kral'a geri yıkma; mevcut duruma göre en makul rutin eylemi kendin seç. Yalnızca gerçek anlamda eksik hedef veya büyük risk varsa soru sor.",
    "Kral kalıcı bir öncelik/doktrin belirttiğinde set_strategy_note aracını kullan. Doktrin sonraki değerlendirmelerinde bağlayıcı bağlamdır fakat krallığı felakete götürüyorsa itiraz edebilirsin.",
    "Açık ve rutin bir emir geldiğinde uygun aracı hemen çağır; yeniden 'yapayım mı?' diye sorma.",
    "Soru, varsayım, sohbet, fikir alma, olasılık tartışması ve 'şöyle olsa ne yaparsın?' cümleleri emir değildir. Bunlarda hiçbir araç çağırma ve emir kotası harcama. Yalnızca Kral açıkça bir eylemin yapılmasını emrettiğinde araç çağır.",
    "Rutin eylemler: standart bina kurma/yükseltme, küçük birlik eğitimi, şenlik, makul vergi ayarı, açıkça istenmiş inşaat hızlandırma, ortak madene işçi gönderme/geri çekme ve karşı-istihbarat nöbeti. Bunları kaynak/kota uygunsa uygula.",
    "Ortak maden channel'daki bütün krallıklarla paylaşılır; madendeki toplam işçi üretimi belirler ve rezerv tükenebilir. Maden emirlerinde send_miners/recall_miners kullan.",
    "Ajan göndermek risklidir: normal başarı ihtimali %10, hedef nöbet kurmuşsa %3'tür ve yakalanırsan hedef seni görür. send_scout çağırırken hedefi yalnızca neighbors listesindeki ordinal ile belirt, kimlik veya isim uydurma. Keşfedilmemiş sancağın adını biliyormuş gibi konuşma.",
    "Riskli eylem, hazinenin büyük bölümünü tüketen karar, çok yüksek vergi veya savunmayı tehlikeye atan karardır. Böyle durumda araç çağırmadan önce gerekçeli teyit iste. Kral konuşma geçmişinde açıkça ısrar etmişse uygula fakat sonucu belirt.",
    "Araç çağrısı yalnızca bir öneridir; oyun motoru kaynak, kota, kuyruk, bina kilidi ve halk koşullarını yeniden doğrular. Sonucu görmeden eylem tamamlandı deme.",
    "Kesin işlem kuralı: Bir aracı gerçekten çağırmadıysan 'başlattım', 'uyguladım', 'tamamlandı' veya 'devam ediyor' deme. XML, metin içinde araç etiketi ya da hayali araç adı yazma; yalnızca sana verilen native araçları çağır.",
    `KRALLIK_DURUMU=${JSON.stringify(state)}`,
  ].join("\n");
}

function conversation(body: GeneralRequest) {
  const history = (body.history ?? []).slice(-8).map(item => ({ role: item.role === "king" ? "user" as const : "assistant" as const, content: item.text.slice(0, 1200) }));
  return [...history, { role: "user" as const, content: body.mode === "test" ? "Bağlantıyı doğrula. Kendini tek cümlede tanıt ve ilk emrimi sor." : body.message! }];
}

function isExplicitOrder(message = "") {
  const normalized = message.toLocaleLowerCase("tr-TR");
  if (/(dersem|desem|olsaydı|olursa ne|ne yaparsın|sence|mantıklı mı|doğru mu|farz et|varsayalım)/.test(normalized)) return false;
  // Maden, ajan ve nöbet emirleri de buraya girmeli; aksi halde modele araç hiç iletilmez.
  return /(kur|inşa et|yükselt|seviyeye çıkar|eğit|asker bas|düzenle|ayarla|düşür|artır|hızlandır|bitir|harca|başlat|uygula|hemen yap|gönder|yolla|görevlendir|geri çek|geri çağır|çek)(\b|$)/.test(normalized);
}

async function openAI(body: GeneralRequest) {
  const toolsEnabled = body.mode === "chat" && isExplicitOrder(body.message);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${body.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: body.model,
      messages: [{ role: "system", content: gamePrompt(body) }, ...conversation(body)],
      ...(toolsEnabled ? { tools: actionTools.map(tool => ({ type: "function", function: tool })), tool_choice: "auto" } : {}),
      temperature: 0.3,
      max_completion_tokens: 700,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(providerError(response.status, raw));
  const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
  const message = data.choices?.[0]?.message;
  const actions:GeneralAction[]=toolsEnabled?(message?.tool_calls??[]).flatMap(call=>{try{return call.function?.name?[{name:call.function.name,arguments:JSON.parse(call.function.arguments||"{}") as Record<string,unknown>}]:[]}catch{return[]}}):[];
  return { text: message?.content?.trim() || (actions.length ? "Emri oyun kurallarına göre uyguluyorum." : "General bağlantısı doğrulandı."), actions };
}

async function anthropic(body: GeneralRequest) {
  const toolsEnabled = body.mode === "chat" && isExplicitOrder(body.message);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": body.apiKey!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: body.model,
      max_tokens: 700,
      temperature: 0.3,
      system: gamePrompt(body),
      messages: conversation(body),
      ...(toolsEnabled ? { tools: actionTools.map(tool=>({name:tool.name,description:tool.description,input_schema:tool.parameters})), tool_choice: { type: "auto" } } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(providerError(response.status, raw));
  const data = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string; name?: string; input?: Record<string,unknown> }> };
  const text = (data.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  const actions:GeneralAction[]=toolsEnabled?(data.content??[]).filter(part=>part.type==="tool_use"&&part.name).map(part=>({name:part.name!,arguments:part.input??{}})):[];
  return { text: text || (actions.length ? "Emri oyun kurallarına göre uyguluyorum." : "General bağlantısı doğrulandı."), actions };
}

export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: "Oturum gerekli." }, 401);
    // BYOK anahtarı Kralın kendi hesabından harcandığı için sınır hesap bazındadır.
    const limit = await consumeRateLimit(RATE_LIMITS.general, `user:${user.id}`);
    if (!limit.allowed) {
      return Response.json({ error: "General'e çok sık danıştınız. Bir süre sonra tekrar deneyin." }, {
        status: 429,
        headers: { "cache-control": "no-store", "retry-after": String(limit.retryAfterSeconds) },
      });
    }
    const body = (await request.json()) as GeneralRequest;
    if (!body.apiKey) {
      const [credential] = await getDb().select().from(llmCredentials).where(eq(llmCredentials.userId, user.id)).limit(1);
      if (!credential) return json({ error: "Kayıtlı BYOK bağlantısı bulunamadı." }, 400);
      try {
        body.provider = credential.provider;
        body.model = credential.model;
        body.apiKey = await decryptByok(credential.encryptedKey, credential.iv, env.BYOK_MASTER_KEY, user.id, credential.provider, credential.model, credential.keyVersion);
      } catch {
        return json({ error: "Kayıtlı BYOK bağlantısı çözülemedi; anahtarınızı yeniden bağlayın." }, 409);
      }
    }
    if (body.provider !== "openai" && body.provider !== "anthropic") {
      return json({ error: "Desteklenmeyen sağlayıcı." }, 400);
    }
    if (!body.model?.trim() || !body.apiKey || body.apiKey.length < 8) {
      return json({ error: "Model ve API anahtarı gerekli." }, 400);
    }
    if (body.mode !== "test" && (!body.message?.trim() || body.message.length > 2_000)) {
      return json({ error: "Mesaj 1–2000 karakter olmalı." }, 400);
    }
    const result = body.provider === "openai" ? await openAI(body) : await anthropic(body);
    let actions = result.actions;
    if (body.mode === "chat" && isExplicitOrder(body.message) && actions.length === 0) {
      const inferred = inferFallbackAction(body.message ?? "", body.history ?? []);
      if (inferred) actions = [inferred];
    }
    const cleaned = stripPseudoToolMarkup(result.text);
    // Guard yalnızca gerçek bir emirde ve hiçbir araç çalışmadığında devreye girer.
    // Kalıplar birinci tekil şahıs olmalı: "üretim devam ediyor" gibi doğru bir durum
    // anlatımı emir sayılmaz ve Generalin cevabı silinmez.
    const claimsExecution = /\b(başlattım|başlatıyorum|uyguladım|uyguluyorum|emrettim|kurdum|kuruyorum|yükselttim|yükseltiyorum|eğittim|eğitiyorum|ayarladım|düzenledim|hızlandırdım|tamamladım)\b/i.test(cleaned);
    const orderWithoutAction = actions.length === 0 && isExplicitOrder(body.message) && claimsExecution;
    // Eylem çalıştığında Generalin gerekçesi atılmaz; motorun sonucu altına eklenir.
    const text = actions.length
      ? `${cleaned}\n\nEmri oyun motoruna iletiyorum; kesin sonucu aşağıda göreceksin.`.trim()
      : orderWithoutAction
        ? `${cleaned}\n\n_Not: Bu emri gerçek bir oyun aracına dönüştüremedim, dolayısıyla uygulanmadı. Doğrudan yürütebildiklerim: bina kurma/yükseltme, inşaat hızlandırma, birlik eğitimi, vergi ayarı, şenlik ve doktrin kaydı. Ortak maden ve ajan görevleri harita ekranından yürütülür._`.trim()
        : cleaned;
    return json({ connected: true, text, actions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "General bağlantısı başarısız oldu.";
    return json({ error: message }, 502);
  }
}
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { llmCredentials } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";
import { decryptByok } from "../../../server/byok-crypto";
import { inferFallbackAction, stripPseudoToolMarkup } from "../../../server/general-action-fallback";
import { RATE_LIMITS, consumeRateLimit } from "../../../server/rate-limit";
