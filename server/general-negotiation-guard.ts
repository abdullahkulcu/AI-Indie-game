import type { TableBrief } from "./negotiation-brief";

/** General aracından gelen, henüz oyun motoruna iletilmemiş eylem. */
export type GeneralNegotiationAction = { name: string; arguments: Record<string, unknown> };

export function isNegotiationAction(action: Pick<GeneralNegotiationAction, "name">) {
  return action.name === "open_negotiation" || action.name === "reply_negotiation" || action.name === "propose_terms";
}

/** Genel emir fiilleri müzakere niyeti değildir; bu dar kapı yanlış masa işlemini engeller. */
const NEGOTIATION_INTENT = /(müzakere[\p{L}]*|elçi[\p{L}]*|anlaşma[\p{L}]*|saldırmazlık|ittifak[\p{L}]*|haraç[\p{L}]*|ültimatom[\p{L}]*|kiralık birlik|paralı asker|geçiş izni|masa[\p{L}]*|karşı teklif|teklif[\p{L}]*|şart[\p{L}]*)/iu;

export function mentionsNegotiation(message = "") {
  return NEGOTIATION_INTENT.test(message.toLocaleLowerCase("tr-TR"));
}

function ordinal(value: unknown) {
  const parsed = Math.floor(Number(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isUsableTable(table: TableBrief | undefined) {
  return table?.durum === "open" || table?.durum === "awaiting_king";
}

/** Sunucu tarafındaki son kapı: modelin yanlış müzakere araç çağrısını uygulatmaz. */
export function guardNegotiationActions(input: {
  actions: GeneralNegotiationAction[];
  message?: string;
  tables: TableBrief[];
  neighborCount: number;
}) {
  const explicit = mentionsNegotiation(input.message);
  const notes: string[] = [];
  let blocked = false;
  const actions = input.actions.filter(action => {
    if (!isNegotiationAction(action)) return true;
    if (!explicit) {
      blocked = true;
      notes.push("⏸ Müzakere emri açık değildi; masa açmadım ve mevcut masaya yazmadım. Müzakere istiyorsanız hedef sancağı ve konuyu açıkça belirtin.");
      return false;
    }
    if (action.name === "open_negotiation") {
      const target = ordinal(action.arguments.target_ordinal);
      if (target === null || target > input.neighborCount) {
        blocked = true;
        notes.push("⏸ Müzakere için geçerli bir hedef seçilemedi. Örneğin: “2. sancakla saldırmazlık müzakeresi aç.”");
        return false;
      }
      return true;
    }
    const table = input.tables[(ordinal(action.arguments.table_ordinal) ?? 0) - 1];
    if (!isUsableTable(table)) {
      blocked = true;
      notes.push("⏸ Bu emir için açık bir müzakere masası yok. Önce hedef sancağı ve görüşme konusunu belirtin ya da açık masanın sıra numarasıyla cevap verin.");
      return false;
    }
    if (action.name === "reply_negotiation" && table.durum === "awaiting_king" && table.sartiSunan === "biz") {
      blocked = true;
      notes.push("⏸ Bu masada sunduğumuz şartın karşı tarafça değerlendirilmesini bekliyoruz; yeni bir cevap göndermedim.");
      return false;
    }
    return true;
  });
  return { actions, notes: [...new Set(notes)], blocked };
}
