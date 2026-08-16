type Provider = "openai" | "anthropic";

type GeneralRequest = {
  provider?: Provider;
  model?: string;
  apiKey?: string;
  mode?: "test" | "chat";
  message?: string;
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
  };
};

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
    "Oyunda gerçekten yapılmamış bir eylemi yapılmış gibi gösterme; karar yetkisi Kraldadır.",
    `KRALLIK_DURUMU=${JSON.stringify(state)}`,
  ].join("\n");
}

async function openAI(body: GeneralRequest) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${body.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: body.model,
      messages: [
        { role: "system", content: gamePrompt(body) },
        {
          role: "user",
          content:
            body.mode === "test"
              ? "Bağlantıyı doğrula. Kendini tek cümlede tanıt ve ilk emrimi sor."
              : body.message,
        },
      ],
      temperature: 0.3,
      max_completion_tokens: 700,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(providerError(response.status, raw));
  const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() || "General bağlantısı doğrulandı.";
}

async function anthropic(body: GeneralRequest) {
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
      messages: [
        {
          role: "user",
          content:
            body.mode === "test"
              ? "Bağlantıyı doğrula. Kendini tek cümlede tanıt ve ilk emrimi sor."
              : body.message,
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(providerError(response.status, raw));
  const data = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }> };
  return (data.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim() || "General bağlantısı doğrulandı.";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GeneralRequest;
    if (body.provider !== "openai" && body.provider !== "anthropic") {
      return json({ error: "Desteklenmeyen sağlayıcı." }, 400);
    }
    if (!body.model?.trim() || !body.apiKey || body.apiKey.length < 8) {
      return json({ error: "Model ve API anahtarı gerekli." }, 400);
    }
    if (body.mode !== "test" && (!body.message?.trim() || body.message.length > 2_000)) {
      return json({ error: "Mesaj 1–2000 karakter olmalı." }, 400);
    }
    const text = body.provider === "openai" ? await openAI(body) : await anthropic(body);
    return json({ connected: true, text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "General bağlantısı başarısız oldu.";
    return json({ error: message }, 502);
  }
}
