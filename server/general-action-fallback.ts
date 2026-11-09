import { buildingAliases } from "../engine/catalog";
export type FallbackAction = { name: string; arguments: Record<string, unknown> };

// Takma adlar kataloğdan türer; elle yazılan liste sapıyordu.
const buildings = buildingAliases;

/** Ortak maden ve istihbarat emirleri; bina kataloğundan önce denenir çünkü "maden" ikisinde de geçer. */
function inferWorldAction(direct: string): FallbackAction | null {
  const sharedMine = /(ortak maden|ortak demir|madene|madendeki|maden'e)/.test(direct);
  if (sharedMine && /(geri çek|geri cek|geri çağır|geri cagir|çek$|geri al)/.test(direct)) return { name: "recall_miners", arguments: {} };
  if (sharedMine && /(gönder|gonder|yolla|görevlendir|gorevlendir)/.test(direct)) {
    const count = direct.match(/(\d{1,2})\s*(işçi|isci|adam|kişi|kisi)/);
    return { name: "send_miners", arguments: { workers: count ? Math.max(1, Math.min(20, Number(count[1]))) : 5 } };
  }
  if (/(ajan|casus|keşif|kesif)/.test(direct) && /(gönder|gonder|yolla|görevlendir|gorevlendir)/.test(direct)) {
    // Ünsüz yumuşaması nedeniyle kök eşleşmesi kullanılır: "sancak" → "sancağa", "krallık" → "krallığa".
    const ordinal = direct.match(/(\d{1,2})\s*\.?\s*(sanca|krall|komşu|komsu|hedef)/);
    return { name: "send_scout", arguments: { target_ordinal: ordinal ? Math.max(1, Number(ordinal[1])) : 1 } };
  }
  if (/(karşı[- ]?istihbarat|karsi[- ]?istihbarat|nöbet|nobet|casus savunma)/.test(direct) && /(kur|başlat|baslat|ayarla|uygula)/.test(direct)) {
    return { name: "raise_counter_intelligence", arguments: {} };
  }
  return null;
}

/** Sağlayıcı yedeğinde de halk oylaması niyetini yalnız açık emirden çıkarır. */
function inferReferendumAction(direct: string): FallbackAction | null {
  if (!/(referandum|halkın görüşünü|halka sor)/.test(direct)) return null;
  if (/(sorsak|soralım mı|yapsak|ne olur|sence|mantıklı mı|doğru mu)/.test(direct)) return null;
  if (!/(sor|sorgula|oylama yap|referandum yap|başlat)/.test(direct)) return null;
  if (/(vergi|verginin)/.test(direct)) {
    if (/(artır|artir|yükselt|yukselt)/.test(direct)) return { name: "hold_referendum", arguments: { topic: "tax_increase" } };
    if (/(indir|azalt|hafiflet|düşür|dusur)/.test(direct)) return { name: "hold_referendum", arguments: { topic: "tax_relief" } };
  }
  if (/(yiyecek|istihkak|erzak|sofra)/.test(direct)) {
    if (/(artır|artir|yükselt|yukselt|tam)/.test(direct)) return { name: "hold_referendum", arguments: { topic: "food_relief" } };
    if (/(indir|azalt|kes|kıs|kis|düşür|dusur)/.test(direct)) return { name: "hold_referendum", arguments: { topic: "food_cut" } };
  }
  // Konu yoksa oylama yerine General'in açıklama istemesi gerekir.
  return null;
}

export function inferFallbackAction(message: string, history: Array<{ text: string }> = []): FallbackAction | null {
  const direct = message.toLocaleLowerCase("tr-TR");
  const referendum = inferReferendumAction(direct);
  if (referendum) return referendum;
  if (/(yükseltsek|yukseltsek|kursak|yapsak|sorsak|ne olur|sence|mantıklı mı|doğru mu|dersem|desem|olsaydı|göndersek|gondersek|yollasak)/.test(direct)) return null;
  if (!/(başlat|baslat|kur|yükselt|yukselt|seviyeye çıkar|seviyeye cikar|uygula|devam et|gönder|gonder|yolla|görevlendir|gorevlendir|geri çek|geri cek|geri çağır|geri cagir)/.test(direct)) return null;
  const worldAction = inferWorldAction(direct);
  if (worldAction) return worldAction;
  const context = [message, ...history.slice(-5).reverse().map(item => item.text)].join("\n").toLocaleLowerCase("tr-TR");
  const match = buildings.find(([, aliases]) => aliases.some(alias => context.includes(alias)));
  if (!match) return null;
  const levelMatch = context.match(/(?:sv\.?|seviye)\s*(\d)/i);
  const targetLevel = levelMatch ? Number(levelMatch[1]) : context.includes("kur") ? 1 : null;
  if (!targetLevel || targetLevel < 1 || targetLevel > 6) return null;
  return { name: "build_structure", arguments: { building_type: match[0], target_level: targetLevel, confirmed_risk: false } };
}

export function stripPseudoToolMarkup(text: string) {
  return text.replace(/<call_tool>[\s\S]*?<\/call_tool>/gi, "").replace(/<tool[^>]*>[\s\S]*?<\/tool[^>]*>/gi, "").trim();
}
