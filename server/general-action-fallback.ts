export type FallbackAction = { name: string; arguments: Record<string, unknown> };

const buildings: Array<[string, string[]]> = [
  ["keep", ["kale"]], ["wheat_farm", ["buğday tarlası", "bugday tarlasi"]], ["lumberjack", ["oduncu kulübesi", "oduncu kulubesi"]],
  ["quarry", ["taş ocağı", "tas ocagi"]], ["town_square", ["meydan"]], ["barracks", ["kışla", "kisla"]], ["apple_orchard", ["elma bahçesi", "elma bahcesi"]],
  ["mill", ["değirmen", "degirmen"]], ["market", ["pazar"]], ["wall", ["sur"]], ["mine", ["maden"]],
];

export function inferFallbackAction(message: string, history: Array<{ text: string }> = []): FallbackAction | null {
  const direct = message.toLocaleLowerCase("tr-TR");
  if (/(yükseltsek|yukseltsek|kursak|ne olur|sence|mantıklı mı|doğru mu|dersem|desem|olsaydı)/.test(direct)) return null;
  if (!/(başlat|baslat|kur|yükselt|yukselt|seviyeye çıkar|seviyeye cikar|uygula|devam et)/.test(direct)) return null;
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
