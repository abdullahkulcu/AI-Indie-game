/**
 * HALK-AI KİŞİLİKLERİ (persona) — TEK KAYNAK.
 *
 * Halkın kendi AI'sı (bkz. `docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md`,
 * Fikir 0) her channel'da aynı tonda konuşmaz: oyun kurucusu bir channel'a
 * "isyankâr", başka birine "bağlı" bir halk verebilir. Bu liste o tonların
 * TAM listesidir ve yalnızca burada yaşar.
 *
 * Neden motorda: `engine/negotiation.ts`'in `NEGOTIATION_TOPICS`'i ile birebir
 * aynı sebep. Liste bir yerde (admin arayüzünde), doğrulaması başka yerde
 * (uçta), prompt'u üçüncü yerde yazıldığında ikisi sessizce sapar ve admin
 * seçtiği kişiliğin uçta reddedildiğini sebebini göremeden yaşar. Şemadaki
 * `text(..., { enum })` kısıtı, uçtaki doğrulama ve (ileride) Fikir 2'nin
 * prompt'u AYNI diziden okur; tip de diziden TÜRETİLİR ki ayrışamasınlar.
 *
 * Motor saflığı bozulmaz: burada yalnızca sabit metin var — saat, rastgelelik,
 * veritabanı ya da şifreleme YOK. Anahtarın kendisi ve şifrelemesi
 * `server/byok-crypto.ts` ile `server/populace-ai-credentials.ts` içinde durur.
 */

/** Kişilik kimlikleri — veritabanı sütununun enum'u da bu diziden türer. */
export const POPULACE_PERSONA_IDS = ["isyankar", "zeki_istekli", "bagli_itaatkar"] as const;

export type PopulacePersona = typeof POPULACE_PERSONA_IDS[number];

export type PopulacePersonaProfile = {
  id: PopulacePersona;
  /** Admin panelinde görünen ad. */
  label: string;
  /**
   * Halkın tonunu bir cümleyle anlatan tanım. Fikir 2 prompt kurarken bu
   * metni kullanacak; bu yüzden oyun-içi dille yazılır, teknik dille değil.
   */
  tone: string;
};

/**
 * Kişilik profilleri. Sıra admin panelindeki sıradır: en sert tondan en
 * uysalına.
 */
export const POPULACE_PERSONAS: readonly PopulacePersonaProfile[] = [
  {
    id: "isyankar",
    label: "İsyankâr",
    tone: "Halk Kral'a güvenmez; talebini sitemle söyler, muhalefetin dilini kolayca ödünç alır ve kötüleşen bir gidişi hemen yüzüne vurur.",
  },
  {
    id: "zeki_istekli",
    label: "Zeki-istekli",
    tone: "Halk hesap yapar; ne istediğini gerekçesiyle söyler, komşu sancaklarla kendi durumunu kıyaslar ve karşılığında ne vereceğini de konuşur.",
  },
  {
    id: "bagli_itaatkar",
    label: "Bağlı-itaatkâr",
    tone: "Halk Kral'ın yanındadır; sıkıntısını saygılı bir ricayla dile getirir, sabrı uzundur ama sonsuz değildir.",
  },
];

/** Verilen değer gerçekten bir kişilik mi? Uçlar bunu sorar. */
export function isPopulacePersona(value: unknown): value is PopulacePersona {
  return (POPULACE_PERSONA_IDS as readonly string[]).includes(String(value));
}

/** Kişiliğin profili. Bilinmeyen kimlikte `undefined` döner. */
export function populacePersonaProfile(id: PopulacePersona) {
  return POPULACE_PERSONAS.find((persona) => persona.id === id);
}
