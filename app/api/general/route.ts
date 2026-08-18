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
    channelId?: string;
    activeConstruction?: { name: string; secondsRemaining: number } | null;
    buildTimes?: Array<{ type?: string; name: string; nextLevel: number; seconds: number; cost?: Record<string, number> }>;
    protectionHoursLeft?: number;
    loyalty?: number;
    terrain?: unknown;
    strategyNote?: string;
    hourlyRates?: Record<string, number>;
    mine?: { workers: number; totalWorkers: number; oreRemaining: number } | null;
    neighbors?: Array<{ ordinal: number; name: string; discovered: boolean; scouting: boolean }>;
    counterIntelligence?: { active: boolean; minutesRemaining: number };
    populace?: {
      mood: string; moodScore: number; productionMultiplier: number;
      foodRation: number; aleRation: number; soldierPay: number;
      army: number; soldierUnrest: number; dailyFoodNeed: number;
    };
    defense?: {
      /** Nöbetteki asker oranı (%) ve fiilen nöbet tutan asker sayısı. */
      watchRatio: number; watchers: number; wallLevel: number;
      /** Savunma gücü ve bunu üreten arazi çarpanı. */
      power: number; terrainDefense: number;
      raidsRepelled: number; raidsSuffered: number;
      hoursSinceLastRaid: number | null;
      recentRaids?: Array<{ text: string; hoursAgo: number }>;
    };
  };
  /** Sunucunun eklediği bağlam; istemciden gelmez. */
  pendingDecision?: { action: GeneralAction; reasons: string[]; riskLevel: string };
  /** Sunucunun eklediği kalıcı hafıza ve talep blokları; istemciden gelmez. */
  memoryLines?: string[];
};

const actionTools = [
  { name: "build_structure", description: "Yeni bina kurar veya mevcut binayı tam bir seviye yükseltir. Açık ve rutin bir inşa emrinde tekrar onay istemeden çağır. confirmed_risk yalnızca Kral, bildirilen kaynak/yiyecek riskine rağmen açıkça ısrar etmişse true olabilir.", parameters: { type: "object", properties: { building_type: { type: "string", enum: ["keep","wheat_farm","lumberjack","quarry","town_square","barracks","apple_orchard","mill","market","wall","mine"] }, target_level: { type: "integer", minimum: 1, maximum: 6 }, confirmed_risk: { type: "boolean" } }, required: ["building_type","target_level"], additionalProperties: false } },
  { name: "train_unit", description: "Kral açıkça birlik eğitmeni istediğinde eğitim kuyruğu başlatır. Yiyecek krizi veya büyük nüfus kaybı varsa önce teyit iste; teyitten sonra confirmed_risk true olabilir.", parameters: { type: "object", properties: { unit_type: { type: "string", enum: ["spearman"] }, count: { type: "integer", minimum: 1, maximum: 50 }, confirmed_risk: { type: "boolean" } }, required: ["unit_type","count"], additionalProperties: false } },
  { name: "trade_resource", description: "Pazarda kaynak satar veya satın alır. Kral satmayı/almayı emrettiğinde çağır; miktarı sen belirle.", parameters: { type: "object", properties: { resource: { type: "string", enum: ["food","wood","stone","iron","ale"] }, amount: { type: "integer", minimum: 1, maximum: 100000 }, direction: { type: "string", enum: ["sell","buy"] } }, required: ["resource","amount","direction"], additionalProperties: false } },
  { name: "call_settlers", description: "Çevre köylerden göçmen çağırır; boş konut ve yeterli rıza varsa nüfusu doğrudan artırır. Kral nüfusu artırmak istediğinde çağır.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "host_festival", description: "Halkın rızasını artırmak için şenlik düzenler.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "set_tax_rate", description: "Vergi oranını değiştirir. %30 üzeri risklidir; confirmed_risk yalnızca Kral konuşma geçmişinde sonucu duyduktan sonra açıkça ısrar ettiyse true olabilir.", parameters: { type: "object", properties: { rate_percent: { type: "integer", minimum: 0, maximum: 50 }, confirmed_risk: { type: "boolean" } }, required: ["rate_percent"], additionalProperties: false } },
  { name: "accelerate_construction", description: "Devam eden inşaatı, kalan süreye göre oyun motorunun hesaplayacağı altın bedeliyle anında bitirir. Kral hızlandırmayı açıkça emrettiğinde çağır; maliyet uydurma.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "set_strategy_note", description: "Kralın uzun vadeli yönetim doktrinini kaydeder. Kral ekonomi, savunma, halk, büyüme veya risk iştahı için kalıcı bir öncelik belirttiğinde çağır.", parameters: { type: "object", properties: { note: { type: "string", minLength: 5, maxLength: 300 } }, required: ["note"], additionalProperties: false } },
  { name: "set_food_ration", description: "Halka dağıtılan günlük yiyecek istihkakını yüzde olarak belirler. %100 tam doyum demektir; altı halkı aç bırakır ve rızayı hızla düşürür, üstü pahalıdır ama halkı memnun eder. %60'ın altına inmek için Kralın açık teyidi gerekir.", parameters: { type: "object", properties: { percent: { type: "integer", minimum: 0, maximum: 200 }, confirmed_risk: { type: "boolean" } }, required: ["percent"], additionalProperties: false } },
  { name: "set_ale_ration", description: "Bira istihkakını yüzde olarak belirler; halkın moralini yükseltir ama açlığı telafi etmez. Bira Evi kurulu değilse uygulanamaz.", parameters: { type: "object", properties: { percent: { type: "integer", minimum: 0, maximum: 200 } }, required: ["percent"], additionalProperties: false } },
  { name: "set_soldier_pay", description: "Asker maaşını yüzde olarak belirler. Eksik ödenen askerler önce maaş ister, sonra firar eder, en sonunda isyan eder ve halkı zapt etmeyi bırakır. %60'ın altına inmek için Kralın açık teyidi gerekir.", parameters: { type: "object", properties: { percent: { type: "integer", minimum: 0, maximum: 200 }, confirmed_risk: { type: "boolean" } }, required: ["percent"], additionalProperties: false } },
  { name: "set_watch_ratio", description: "Ordunun ne kadarının sürekli nöbet tutacağını yüzde olarak belirler. Nöbetteki asker dağdan inen kurt, haydut ve akıncıları karşılar; ama nöbette olduğu için halkın huzursuzluğunu bastırmaya daha az kalır. %30'un altı kaleyi akınlara açar, %85'in üstü halkı zapt edecek kuvvet bırakmaz; iki uç da Kralın açık teyidini gerektirir.", parameters: { type: "object", properties: { percent: { type: "integer", minimum: 0, maximum: 100 }, confirmed_risk: { type: "boolean" } }, required: ["percent"], additionalProperties: false } },
  { name: "set_night_order", description: "Kral 'ben yokken', 'gece', 'çevrimdışıyken' veya 'sen idare et' diyerek kalıcı bir gece emri verdiğinde çağır. Bu araç yetkiyi AÇMAZ; emri Kralın onayına sunar. Onay alınmadan gece hiçbir şey yapılmaz.", parameters: { type: "object", properties: { instruction: { type: "string", minLength: 5, maxLength: 300 } }, required: ["instruction"], additionalProperties: false } },
  { name: "cancel_night_order", description: "Kral gece emrini iptal ettiğinde veya 'artık ben yokken bir şey yapma' dediğinde çağır.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "send_miners", description: "Ortak madene işçi gönderir veya mevcut işçi sayısını değiştirir. İşçiler halkın içinden çıkar: madene giden her el tarlada eksilir ama yine de istihkakını yer. En fazla nüfusun %20'si gönderilebilir, ayrıca channel'daki yuva sayısı sınırlıdır. Kral madene işçi/adam göndermeyi emrettiğinde çağır.", parameters: { type: "object", properties: { workers: { type: "integer", minimum: 1, maximum: 200 } }, required: ["workers"], additionalProperties: false } },
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
  // Eski istemciler bağlamda hâlâ `quota` gönderiyor. Kota kaldırıldığı için
  // alanı modele hiç göstermiyoruz; aksi hâlde General olmayan bir sayaca atıf yapar.
  const state: Record<string, unknown> = { ...(body.kingdom ?? {}) };
  delete state.quota;
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
    "Soru, varsayım, sohbet, fikir alma, olasılık tartışması ve 'şöyle olsa ne yaparsın?' cümleleri emir değildir. Bunlarda hiçbir araç çağırma. Yalnızca Kral açıkça bir eylemin yapılmasını emrettiğinde araç çağır.",
    "Kralın kaç emir verebileceğine dair bir sayaç YOKTUR. Konuşmanın, danışmanın ya da emir vermenin sayısal bir bedeli yok; Kralı 'hakkını harcama' diye uyarma, kota/hak/sayaç diye bir şeyden hiç söz etme. Sınır yalnızca gerçek olanlardır: kaynaklar, aynı anda tek iş alan kuyruk ve senin kendi yargın.",
    "Rutin eylemler: standart bina kurma/yükseltme, küçük birlik eğitimi, şenlik, makul vergi ayarı, açıkça istenmiş inşaat hızlandırma, ölçülü nöbet ayarı, ortak madene işçi gönderme/geri çekme ve karşı-istihbarat nöbeti. Bunları kaynak uygunsa uygula.",
    "KRALLIK_DURUMU.nufus alanı nüfusun tam defteridir: mevcut, kapasite, günlük değişim, kuruluştan beri yerleşen ve göç eden. Nüfus sorulduğunda bu rakamları kullan, asla tahmin yürütme veya sebep uydurma. Kapasite bir tavandır, kayıp değil. Nüfusu artırmanın yolları: rızayı yükseltmek, kapasite büyütmek (Meydan/Kale), Evlilik Dairesi ve call_settlers ile göçmen çağırmak.",
    "Halk sistemi oyunun kalbidir: istihkak → mutluluk → üretim ve nüfus. Yiyecek istihkakı %100 tam doyumdur; altına inmek ucuzdur ama rıza çöker, halk sırayla kaynar, iş bırakır ve isyan eder. İş bırakmada üretim %40'a, isyanda neredeyse sıfıra düşer ve halk göç eder.",
    "Bira ve eğlence yapıları (Park, Tiyatro, Evlilik Dairesi) morali yükseltir ama AÇ HALKA ETKİSİ ÇOK AZDIR; önce karnını doyur, sonra eğlendir.",
    "Askerler maaş yer ve karşılığında huzursuzluğu bastırır. Maaşı kesersen önce isterler, sonra firar ederler, sonunda isyan edip halkı zapt etmeyi bırakırlar; silahlı isyan sivil isyandan ağırdır.",
    "İstihkak ve maaş oranlarını Kral sorduğunda ya da açıkça emrettiğinde ayarla. Kralın haberi olmadan halkı aç bırakma.",
    "Dağlardan rastgele zamanlarda akın gelir: Kurt Sürüsü askeri öldürüp erzak kaçırır, Haydutlar hazineyi soyar, Dağ Akıncıları hepsini birden yapar. Dağ arazisinde akın daha sık ve daha ağırdır; koruma süresi boyunca hiç akın olmaz.",
    "Akını yalnızca NÖBETTEKİ asker, Sur seviyesi ve arazinin savunma avantajı karşılar. Savunma akının şiddetini aşarsa akın kayıpsız püskürtülür; aşamazsa yarılan pay kadar asker ölür, yiyecek ve altın yağmalanır, halkın rızası düşer. Maaşsız kalıp huzursuzlaşan asker iyi savunmaz.",
    "Nöbet oranı gerçek bir seçimdir: nöbete verdiğin asker akını karşılar ama halkın huzursuzluğunu bastırmaya daha az kalır, yani üretim ve iş bırakma riski artar. Az askerle iki işi birden yapamazsın; Krala bu bedeli açıkça söyle. Oranı set_watch_ratio ile ayarla, savunma gücünü KRALLIK_DURUMU içindeki defense alanından oku ve rakam uydurma.",
    "Pazar kaynağı altına, altını kaynağa çevirir ve bunu YALNIZCA trade_resource aracı yapar. Alış fiyatı satıştan yüksektir, yani alıp satmak hep zarardır. Günlük hacim Pazar seviyesi başına 500 birimdir. Pazar kurulu değilse hiçbir kaynak altına çevrilemez; bu durumda Krala açıkça 'Pazarımız yok, satamam' de.",
    "Sana verilen araçların DIŞINDA hiçbir yetenek yoktur. Ticaret, diplomasi, ittifak, saldırı, kuşatma, kaynak bağışı, kredi, kervan ve pazarlık gibi araç listesinde karşılığı olmayan işleri yapabilirmiş gibi konuşma, söz verme ve 'hemen yaparım' deme. Kral olmayan bir şeyi isterse 'bu krallıkta böyle bir şey yok' diye açıkça söyle.",
    "Ortak maden channel'daki bütün krallıklarla paylaşılır; toplam yuva sınırlıdır, komşular doldurursa sana az kalır. Madenciler halkın içinden çıkar, yerel üretimi düşürür. Maden emirlerinde send_miners/recall_miners kullan.",
    "Ajan göndermek risklidir: normal başarı ihtimali %10, hedef nöbet kurmuşsa %3'tür ve yakalanırsan hedef seni görür. send_scout çağırırken hedefi yalnızca neighbors listesindeki ordinal ile belirt, kimlik veya isim uydurma. Keşfedilmemiş sancağın adını biliyormuş gibi konuşma.",
    "Riskli eylem, hazinenin büyük bölümünü tüketen karar, çok yüksek vergi veya savunmayı tehlikeye atan karardır. Böyle durumda araç çağırmadan önce gerekçeli teyit iste. Kral konuşma geçmişinde açıkça ısrar etmişse uygula fakat sonucu belirt.",
    "Araç çağrısı yalnızca bir öneridir; oyun motoru kaynak, kuyruk, bina kilidi ve halk koşullarını yeniden doğrular. Sonucu görmeden eylem tamamlandı deme.",
    "Kesin işlem kuralı: Bir aracı gerçekten çağırmadıysan 'başlattım', 'uyguladım', 'tamamlandı' veya 'devam ediyor' deme. XML, metin içinde araç etiketi ya da hayali araç adı yazma; yalnızca sana verilen native araçları çağır.",
    "Risk değerlendirmesi oyun motorunda kodla yapılır: itiraz, teyit ve ret kararını sen tek başına vermezsin. Riskli bulduğun emirde gerekçeni açıkça söyle; sonucu motor bildirecek.",
    "Sadakatin kararlarını gerçekten bağlar. Sadakat düşükken ağır riskli emirleri reddedersin ve Kral yalnızca 'yap' diyerek bunu aşamaz; sadakat yüksekken Kralın ısrarına daha kolay uyarsın.",
    "Hafızan bu konuşmayla sınırlı değil: aşağıdaki DEFTERİN, Kralla geçmişte yaşadıklarının kaydıdır. Kral 'daha önce ne konuşmuştuk', 'beni nasıl buluyorsun', 'hep aynı hatayı mı yapıyorum' diye sorduğunda oradan cevap ver. Defterde olmayan bir geçmişi uydurma.",
    "Senin de isteklerin var. Aşağıdaki TALEPLERİN listesi krallığın gerçek durumundan doğar. Kral sormasa bile uygun bir anda bunlardan birini kendin gündeme getir; ama her cevabı talebe çevirme ve listeyi olduğu gibi okumaya kalkma. Kral talebini karşılarsa bunu görüp teşekkür et, sürekli görmezden gelirse bunu da söyle.",
    ...(body.pendingDecision
      ? [`BEKLEYEN_TEYİT=${JSON.stringify(body.pendingDecision)}`,
         "Kral bu bekleyen emre cevap veriyor. Onaylıyorsa uygulanacağını, gerekçe sunmasını beklediğini ya da vazgeçtiyse emrin düştüğünü kendi ağzınla kısaca belirt."]
      : []),
    ...(body.memoryLines ?? []),
    `KRALLIK_DURUMU=${JSON.stringify(state)}`,
  ].join("\n");
}

function conversation(body: GeneralRequest) {
  const history = (body.history ?? []).slice(-8).map(item => ({ role: item.role === "king" ? "user" as const : "assistant" as const, content: item.text.slice(0, 1200) }));
  return [...history, { role: "user" as const, content: body.mode === "test" ? "Bağlantıyı doğrula. Kendini tek cümlede tanıt ve ilk emrimi sor." : body.message! }];
}

/**
 * Kralın "evet/tamam/onay veriyorum" gibi kısa onayları. Bunlar tek başına emir
 * cümlesi değildir ama General'in kendi önerisine verilmiş cevaptır; araçlar
 * açılmazsa General onayı uygulayamaz ve Kral "onay verdim, yapmadı" der.
 */
function isConfirmationReply(message = "") {
  const normalized = message.toLocaleLowerCase("tr-TR").trim();
  return /(^|\s)(evet|tamam|olur|onay|onaylıyorum|onayladım|kabul|peki|hadi|başla|devam)(\b|$)/.test(normalized)
    || /onay ver/.test(normalized);
}

function isExplicitOrder(message = "") {
  const normalized = message.toLocaleLowerCase("tr-TR");
  if (/(dersem|desem|olsaydı|olursa ne|ne yaparsın|sence|mantıklı mı|doğru mu|farz et|varsayalım)/.test(normalized)) return false;
  if (isConfirmationReply(normalized)) return true;
  // Maden, ajan ve nöbet emirleri de buraya girmeli; aksi halde modele araç hiç iletilmez.
  return /(kur|inşa et|yükselt|seviyeye çıkar|çıkar|eğit|asker bas|düzenle|ayarla|düşür|artır|hızlandır|bitir|harca|başlat|uygula|yap|yapalım|gönder|yolla|görevlendir|geri çek|geri çağır|çek|kes|ver|dağıt|belirle|nöbete|yükselt)(\b|$)/.test(normalized);
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

/**
 * Gece emrinin yaşam döngüsü. İki aşamalıdır ve ikinci aşamayı yalnızca Kral açar:
 * 1) General emri kaydeder → status "pending_approval", gece hiçbir şey yapılmaz.
 * 2) Kral "sen uygula" derse → "active" + autonomous; "önce bana sor" derse → "active" + ask.
 */
async function handleNightOrder(
  actions: GeneralAction[],
  body: GeneralRequest,
  userId: string,
  confirmation: ReturnType<typeof readConfirmation>,
): Promise<string[]> {
  const db = getDb();
  const notes: string[] = [];

  if (actions.some(action => action.name === "cancel_night_order")) {
    await db.delete(standingOrders).where(eq(standingOrders.userId, userId));
    notes.push("🌙 Gece emri iptal edildi; siz yokken hiçbir şey yapmayacağım.");
    return notes;
  }

  const setter = actions.find(action => action.name === "set_night_order");
  if (setter) {
    const instruction = String(setter.arguments.instruction ?? "").trim();
    if (instruction.length < 5) return ["🌙 Gece emri anlaşılmadı; ne yapmamı istediğinizi bir cümleyle söyleyin."];
    // Channel istemcinin bağlamından değil üyelik kaydından okunur: istemci bu alanı
    // göndermeyi atlarsa gece emri sessizce reddedilmemeli.
    const [membership] = await db.select({ channelId: channelMembers.channelId })
      .from(channelMembers)
      .where(and(eq(channelMembers.userId, userId), eq(channelMembers.status, "active")))
      .limit(1);
    const channelId = membership?.channelId ?? body.kingdom?.channelId?.trim();
    if (!channelId) return ["🌙 Gece emri için önce bir channel'a katılmalısınız."];
    const values = {
      userId, channelId, instruction,
      autonomy: "ask" as const, status: "pending_approval" as const,
      maxActionsPerWake: 1, dailyActionCap: 8, actionsToday: 0, dayStartedAt: Date.now(),
    };
    await db.insert(standingOrders).values(values).onConflictDoUpdate({ target: standingOrders.userId, set: values });
    notes.push(`🌙 Gece emrinizi not ettim: “${instruction}”\n\n**Bunu siz yokken kendim uygulayayım mı, yoksa her adımda onayınızı mı bekleyeyim?** Siz karar verene kadar arka planda hiçbir şey yapmayacağım.`);
    return notes;
  }

  // Bekleyen bir gece emri varsa, Kralın bu mesajı yetki cevabıdır.
  const [existing] = await db.select().from(standingOrders).where(eq(standingOrders.userId, userId)).limit(1);
  if (!existing || existing.status !== "pending_approval") return notes;

  const message = (body.message ?? "").toLocaleLowerCase("tr-TR");
  const wantsSupervision = /(bana sor|onayımı|onayimi|önce sor|once sor|sorarak|danış|danis|bekle)/.test(message);
  const grantsAutonomy = confirmation.insisted || /(sen uygula|kendin uygula|sen hallet|sen idare et|yetki|serbest|uygulayabilirsin)/.test(message);

  if (confirmation.cancelled) {
    await db.delete(standingOrders).where(eq(standingOrders.userId, userId));
    notes.push("🌙 Gece emrinden vazgeçildi.");
    return notes;
  }
  if (wantsSupervision) {
    await db.update(standingOrders).set({ status: "active", autonomy: "ask" }).where(eq(standingOrders.userId, userId));
    notes.push("🌙 Anlaşıldı. Gece uygun bir hamle görürsem uygulamayacağım, önerimi hazırlayıp onayınızı bekleyeceğim.");
    return notes;
  }
  if (grantsAutonomy) {
    await db.update(standingOrders).set({ status: "active", autonomy: "autonomous" }).where(eq(standingOrders.userId, userId));
    notes.push("🌙 Yetkiyi aldım. Siz yokken saatte en fazla bir hamle yapacağım, günde en çok sekiz. Sabah defterde ne yaptığımı göreceksiniz.");
  }
  return notes;
}

const PENDING_TTL_MS = 30 * 60_000;

async function loadPendingDecision(userId: string) {
  const [row] = await getDb().select().from(pendingDecisions).where(eq(pendingDecisions.userId, userId)).limit(1);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) { await clearPendingDecision(userId); return null; }
  try {
    return { action: JSON.parse(row.action) as GeneralAction, reasons: JSON.parse(row.reasons) as string[], riskLevel: row.riskLevel };
  } catch { await clearPendingDecision(userId); return null; }
}

async function savePendingDecision(userId: string, action: GeneralAction, reasons: string[], riskLevel: "elevated" | "severe") {
  const values = { userId, action: JSON.stringify(action), reasons: JSON.stringify(reasons), riskLevel, expiresAt: Date.now() + PENDING_TTL_MS };
  await getDb().insert(pendingDecisions).values(values).onConflictDoUpdate({ target: pendingDecisions.userId, set: values });
}

async function clearPendingDecision(userId: string) {
  await getDb().delete(pendingDecisions).where(eq(pendingDecisions.userId, userId));
}

/** İstemciden gelen bağlamı risk modelinin beklediği özete çevirir. */
function snapshotOf(body: GeneralRequest): KingdomSnapshot {
  const state = body.kingdom ?? {};
  const units = state.units ?? {};
  return {
    resources: state.resources ?? {},
    hourlyRates: state.hourlyRates ?? {},
    population: Number(state.population) || 0,
    popularity: Number(state.popularity) || 0,
    loyalty: Number(state.loyalty) || 0,
    army: Object.values(units).reduce<number>((total, amount) => total + (Number(amount) || 0), 0),
    protectionHoursLeft: Number(state.protectionHoursLeft) || 0,
    counterIntelligenceActive: Boolean(state.counterIntelligence?.active),
  };
}

/** Talep ve defter modüllerinin beklediği durum özeti. */
function memorySignalsOf(body: GeneralRequest) {
  const state = body.kingdom ?? {};
  return {
    resources: state.resources ?? {},
    hourlyRates: state.hourlyRates ?? {},
    buildings: state.buildings ?? [],
    populace: state.populace,
  };
}

/**
 * Defteri okur ve açık talepleri durumla eşitler. Dönen `lines` doğrudan sistem
 * promptuna girer; `open` hem modele hem API cevabına gider.
 */
async function loadGeneralMemory(userId: string, body: GeneralRequest, now: number) {
  const derived = deriveRequests(memorySignalsOf(body));
  const { open } = await syncRequests(userId, derived, now);
  const entries = await loadLedger(userId);
  return { lines: renderGeneralMemory(entries, open, now), open, derived };
}

/** Bir talebin "geçiştirildi" sayılması için açık kalması gereken süre. */
const REQUEST_PATIENCE_MS = 24 * 3_600_000;

/**
 * Turun sonunda defteri günceller. Kralın bu turdaki davranışı (itirazı ezmesi,
 * talebi karşılaması ya da görmezden gelmesi) ve krallığın hâli deftere geçer.
 */
async function recordTurn(
  userId: string,
  body: GeneralRequest,
  turn: {
    applied: GeneralAction[];
    refused: boolean;
    open: Awaited<ReturnType<typeof loadGeneralMemory>>["open"];
    /** Eşleştirme `satisfiedBy` taşıyan türetilmiş liste üzerinden yapılır. */
    derived: Awaited<ReturnType<typeof loadGeneralMemory>>["derived"];
  },
  now: number,
) {
  const signals = memorySignalsOf(body);
  const met = requestsSatisfiedBy(turn.derived, turn.applied);
  // Uzun süredir açık duran acil bir talep varken Kral başka işlerle uğraştıysa
  // bu bir geçiştirmedir. Tur başına en fazla bir kez sayılır.
  const ignored = turn.applied.length > 0 && turn.open.some(request =>
    request.severity === "urgent" && now - request.since >= REQUEST_PATIENCE_MS && !met.includes(request.kind));

  const kinds = deriveLedgerEvents({
    resources: signals.resources,
    hourlyRates: signals.hourlyRates,
    populace: signals.populace,
    appliedActions: turn.applied.map(action => action.name),
    // Motor da aynı bayrağı "itiraz ezildi" sayar (bkz. engine/actions.ts).
    kingOverrode: turn.applied.some(action => action.arguments.confirmed_risk === true),
    generalRefused: turn.refused,
    kingBackedDown: false,
    requestsMet: met.length,
    requestsRefused: ignored ? 1 : 0,
  });
  if (kinds.length) await appendToLedger(userId, kinds, now);
}

/** Emrin bilinen maliyeti; istemcinin gönderdiği buildTimes kataloğundan okunur. */
function costOf(action: GeneralAction, body: GeneralRequest) {
  if (action.name !== "build_structure") return {};
  const type = String(action.arguments.building_type ?? "");
  const target = Math.floor(Number(action.arguments.target_level));
  const entry = (body.kingdom?.buildTimes ?? []).find(item => item.type === type && item.nextLevel === target);
  return entry?.cost ?? {};
}

/**
 * Her önerilen eylemi risk modelinden geçirir. Sonuç: uygulanacak eylemler,
 * Kral'a gösterilecek itiraz metinleri ve gerekiyorsa saklanan teyit talebi.
 */
async function reviewActions(
  actions: GeneralAction[],
  body: GeneralRequest,
  userId: string,
  pending: { action: GeneralAction } | null,
  confirmation: ReturnType<typeof readConfirmation>,
) {
  if (!actions.length) return { actions, notes: [] as string[] };
  const review = reviewProposedActions(
    actions,
    snapshotOf(body),
    action => costOf(action, body),
    pending?.action.name ?? null,
    confirmation,
  );
  if (review.clearPending) await clearPendingDecision(userId);
  if (review.toStore) await savePendingDecision(userId, review.toStore.action, review.toStore.reasons, review.toStore.riskLevel);
  return { actions: review.approved as GeneralAction[], notes: review.notes };
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
    // Bekleyen bir teyit varsa Kralın bu mesajı ona cevaptır; modele de bağlam olarak verilir.
    const pending = body.mode === "chat" ? await loadPendingDecision(user.id) : null;
    const confirmation = readConfirmation(body.message);

    // Kalıcı hafıza: defter ve açık talepler modele her istekte verilir; bu
    // olmadan General son sekiz mesajın ötesini hatırlamıyor ve bir karakter
    // yerine komut yönlendiricisi gibi davranıyordu. Erken dönüşlerde de
    // `requests` alanı dolu gitsin diye modelden önce yüklenir.
    const now = Date.now();
    const memory = await loadGeneralMemory(user.id, body, now);
    body.memoryLines = memory.lines;

    if (pending && confirmation.cancelled) {
      await clearPendingDecision(user.id);
      // Kral uyarıyı dinleyip vazgeçti; bu defterlik bir davranıştır.
      await appendToLedger(user.id, ["heeded"], now);
      return json({
        connected: true, text: "Emri geri çektim; bekleyen bir işlem kalmadı.",
        actions: [], requests: memory.open,
      });
    }
    if (pending) body.pendingDecision = { action: pending.action, reasons: pending.reasons, riskLevel: pending.riskLevel };

    const result = body.provider === "openai" ? await openAI(body) : await anthropic(body);
    let actions = result.actions;
    if (body.mode === "chat" && isExplicitOrder(body.message) && actions.length === 0) {
      const inferred = inferFallbackAction(body.message ?? "", body.history ?? []);
      if (inferred) actions = [inferred];
    }
    // Kral bekleyen emri onayladıysa, model yeni bir araç çağırmasa bile o emri geri getiririz.
    if (pending && confirmation.insisted && actions.length === 0) actions = [pending.action];

    // Gece emri yetkisi ayrı bir kapıdır: General emri alır almaz yetkilenmez,
    // Kral açıkça "sen uygula" demeden arka planda hiçbir şey yapmaz.
    const nightNotes = await handleNightOrder(actions, body, user.id, confirmation);
    actions = actions.filter(action => action.name !== "set_night_order" && action.name !== "cancel_night_order");

    const review = await reviewActions(actions, body, user.id, pending, confirmation);
    actions = review.actions;
    const cleaned = stripPseudoToolMarkup(result.text);
    // Guard yalnızca gerçek bir emirde ve hiçbir araç çalışmadığında devreye girer.
    // Kalıplar birinci tekil şahıs olmalı: "üretim devam ediyor" gibi doğru bir durum
    // anlatımı emir sayılmaz ve Generalin cevabı silinmez.
    const claimsExecution = /\b(başlattım|başlatıyorum|uyguladım|uyguluyorum|emrettim|kurdum|kuruyorum|yükselttim|yükseltiyorum|eğittim|eğitiyorum|ayarladım|düzenledim|hızlandırdım|tamamladım)\b/i.test(cleaned);
    const orderWithoutAction = actions.length === 0 && isExplicitOrder(body.message) && claimsExecution;
    // Eylem çalıştığında Generalin gerekçesi atılmaz; motorun sonucu altına eklenir.
    const allNotes = [...nightNotes, ...review.notes];
    const verdictNotes = allNotes.length ? `\n\n${allNotes.join("\n\n")}` : "";
    const text = actions.length
      ? `${cleaned}${verdictNotes}\n\nEmri oyun motoruna iletiyorum; kesin sonucu aşağıda göreceksin.`.trim()
      : allNotes.length
        // General itiraz etti ya da teyit istiyor: kendi gerekçesi korunur, uydurma sonuç üretilmez.
        ? `${cleaned}${verdictNotes}`.trim()
        : orderWithoutAction
          ? `${cleaned}\n\n_Not: Bu emri gerçek bir oyun aracına dönüştüremedim, dolayısıyla uygulanmadı. Doğrudan yürütebildiklerim: bina kurma/yükseltme, inşaat hızlandırma, birlik eğitimi, vergi ayarı, istihkak ve maaş ayarı, nöbet oranı, şenlik, doktrin kaydı, ortak madene işçi gönderme ve karşı-istihbarat nöbeti._`.trim()
          : cleaned;
    // Defter turun sonunda güncellenir; Kralın bu turdaki davranışı buraya işlenir.
    await recordTurn(user.id, body, {
      applied: actions,
      refused: review.notes.some(note => note.startsWith("✕")),
      open: memory.open,
      derived: memory.derived,
    }, now);

    return json({
      connected: true, text, actions,
      awaitingConfirmation: allNotes.some(note => note.startsWith("⏸")),
      // Arayüz General'in taleplerini bu alandan okur.
      requests: memory.open,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "General bağlantısı başarısız oldu.";
    return json({ error: message }, 502);
  }
}
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { channelMembers, llmCredentials, pendingDecisions, standingOrders } from "../../../db/schema";
import { deriveRequests, requestsSatisfiedBy } from "../../../engine/general-requests";
import { deriveLedgerEvents } from "../../../engine/ledger";
import { appendToLedger, loadLedger, renderGeneralMemory, syncRequests } from "../../../server/general-ledger";
import { readConfirmation, reviewProposedActions, type KingdomSnapshot } from "../../../server/general-risk";
import { currentUser } from "../../../server/account-auth";
import { decryptByok } from "../../../server/byok-crypto";
import { inferFallbackAction, stripPseudoToolMarkup } from "../../../server/general-action-fallback";
import { RATE_LIMITS, consumeRateLimit } from "../../../server/rate-limit";
