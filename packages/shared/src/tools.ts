/**
 * General'ın kullanabileceği tool/function şeması — GDD §14.3.
 *
 * Şema sağlayıcıdan bağımsız tutulur; her adaptör (§15.4) bunu kendi biçimine
 * çevirir. Buradaki `description` alanları doğrudan modele gider, bu yüzden
 * kuralın kendisini de anlatırlar — zayıf bir modelin bile doğru aracı seçmesi
 * hedeflenir.
 *
 * Kritik: bu şema bir **yetki listesi değil**. Backend her çağrıyı yeniden
 * doğrular (§15.5); buradaki bir alanın var olması modelin onu kullanmaya
 * hakkı olduğu anlamına gelmez.
 */

import { BALANCE } from './balance.js';
import { RENTABLE_UNIT_TYPES } from './units.js';
import {
  BUILDING_TYPES,
  PROPOSAL_TYPES,
  RESOURCES,
  UNIT_TYPES,
  type LlmToolDefinition,
} from './types.js';

const PRIMARY_TRADE_RESOURCES = ['gold', 'food', 'stone', 'wood', 'iron', 'ale'];

export const GENERAL_TOOLS: readonly LlmToolDefinition[] = [
  {
    name: 'get_kingdom_status',
    description:
      'Krallığın güncel durumunu okur (kaynaklar, bina/eğitim kuyruğu, ordu, nüfus, skorlar, darboğazlar). ' +
      'Emir kotasından DÜŞMEZ — istediğin kadar çağırabilirsin. Karar vermeden önce durumu doğrulamak için kullan.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_realm_intel',
    description:
      'Çevredeki krallıkları, aralarındaki ilişkileri, pazardaki açık ilanları ve son bölgesel haberleri okur. ' +
      'Emir kotasından DÜŞMEZ. Bir diplomasi ya da saldırı kararından önce karşı tarafın itibarını buradan öğren.',
    parameters: {
      type: 'object',
      properties: {
        target_kingdom_id: {
          type: 'string',
          description: 'Belirli bir krallık hakkında ayrıntı isteniyorsa kimliği; boş bırakılırsa genel bölge özeti döner.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'build_structure',
    description:
      'Krallıkta yeni bir bina inşa eder ya da mevcut binayı yükseltir. 1 emir harcar. ' +
      'Kaynak yetmiyorsa ya da Kale seviyesi bina için düşükse çağrı reddedilir — maliyeti tahmin etme, ' +
      'gerekirse önce get_kingdom_status ile kontrol et.',
    parameters: {
      type: 'object',
      properties: {
        building_type: {
          type: 'string',
          description: 'İnşa edilecek/yükseltilecek bina tipi.',
          enum: [...BUILDING_TYPES],
        },
        target_level: {
          type: 'integer',
          description: 'Hedef seviye. Yeni bina için 1, yükseltme için mevcut seviye + 1.',
          minimum: 1,
          maximum: 8,
        },
        building_id: {
          type: 'string',
          description:
            'Aynı tipten birden fazla bina varsa (tarla, maden, taş ocağı, kule) yükseltilecek olanın kimliği. ' +
            'Yeni bina inşa ediliyorsa boş bırak.',
        },
      },
      required: ['building_type', 'target_level'],
      additionalProperties: false,
    },
  },
  {
    name: 'train_unit',
    description:
      'Belirtilen birim tipinden eğitim kuyruğuna ekler. 1 emir harcar. ' +
      'Unutma: her birim nüfustan çalar (Kiralık Asker hariç) — ordu büyütmek ekonomiyi küçültür.',
    parameters: {
      type: 'object',
      properties: {
        unit_type: { type: 'string', description: 'Eğitilecek birim tipi.', enum: [...UNIT_TYPES] },
        count: { type: 'integer', description: 'Adet.', minimum: 1, maximum: 5000 },
      },
      required: ['unit_type', 'count'],
      additionalProperties: false,
    },
  },
  {
    name: 'hire_mercenaries',
    description:
      'Altın karşılığı anında Kiralık Asker satın alır — eğitim süresi yok, nüfus maliyeti yok, ama pahalıdır ' +
      've erzak yükü ağırdır. Acil savunma için tasarlanmıştır. 1 emir harcar.',
    parameters: {
      type: 'object',
      properties: { count: { type: 'integer', description: 'Adet.', minimum: 1, maximum: 2000 } },
      required: ['count'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_army',
    description:
      'Bir orduyu belirtilen koordinata gönderir. 1 emir harcar. Sefer hızı ordudaki EN YAVAŞ birime göre ' +
      'hesaplanır — mancınık götüren ordu mancınık hızında yürür. Kuşatma birimi olmayan bir ordu yüksek ' +
      'seviyeli suru düşüremez. intent="attack" her zaman Kral onayı gerektiren büyük bir karardır.',
    parameters: {
      type: 'object',
      properties: {
        target_x: { type: 'integer', description: 'Hedef tile X koordinatı.' },
        target_y: { type: 'integer', description: 'Hedef tile Y koordinatı.' },
        intent: {
          type: 'string',
          description:
            'attack = toprak ele geçirme amaçlı saldırı; raid = sadece kaynak yağması, toprak el değiştirmez; ' +
            'reinforce = müttefike/kendi bölgene takviye; scout = keşif.',
          enum: ['attack', 'reinforce', 'scout', 'raid'],
        },
        units: {
          type: 'object',
          description:
            'Sefere çıkacak birimler: {"spearman": 30, "archer": 20} biçiminde birim tipi → adet eşlemesi.',
        },
        tactic: {
          type: 'string',
          description: 'Çatışmada kullanılacak taktik. Belirtilmezse cepheden karşılama varsayılır.',
          enum: ['ambush', 'frontal', 'withdraw_to_keep', 'terrain_advantage'],
        },
      },
      required: ['target_x', 'target_y', 'intent', 'units'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_caravan',
    description:
      'Nakliye kervanı gönderir — fethedilmiş bölgeden kaynak taşımak ya da ticaret teslimatı yapmak için. ' +
      `Sefer başına en fazla ${BALANCE.caravan.capacityPerTrip} birim taşınır; daha fazlası için birden fazla ` +
      'sefer gerekir. Mesafe sefer süresini belirler. 1 emir harcar.',
    parameters: {
      type: 'object',
      properties: {
        origin_tile_id: { type: 'string', description: 'Kaynağın bulunduğu tile kimliği.' },
        target_tile_id: { type: 'string', description: 'Kaynağın taşınacağı tile kimliği.' },
        resource_type: { type: 'string', description: 'Taşınacak kaynak.', enum: [...RESOURCES] },
        amount: {
          type: 'integer',
          description: `Taşınacak miktar (üst sınır ${BALANCE.caravan.capacityPerTrip}).`,
          minimum: 1,
        },
      },
      required: ['origin_tile_id', 'target_tile_id', 'resource_type'],
      additionalProperties: false,
    },
  },
  {
    name: 'host_festival',
    description:
      'Yiyecek + Bira + Altın tüketerek şenlik düzenler; anlık popülerlik artışı ve birkaç gün süren küçük bir ' +
      'bonus verir. 1 emir harcar. DİKKAT: aynı hafta içinde tekrarlanırsa etkisi her seferinde yarıya iner — ' +
      'sürekli şenlik yerine vergi dengesi ve yiyecek arzını düzeltmek daha kalıcı çözümdür.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'set_tax_rate',
    description:
      'Vergi oranını ayarlar. Yüksek vergi altın üretimini artırır ama popülerliği düşürür; düşük popülerlik ' +
      'moral üzerinden savaş gücünü de zayıflatır. 1 emir harcar.',
    parameters: {
      type: 'object',
      properties: {
        rate_percent: { type: 'integer', description: 'Vergi oranı (0-100).', minimum: 0, maximum: 100 },
      },
      required: ['rate_percent'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_diplomacy_message',
    description:
      'Başka bir krallığın General\'ına diplomatik mesaj/teklif gönderir. Görüşme senin ile karşı General ' +
      'arasında yürür; Kral asla karşı tarafa doğrudan yazmaz. 1 emir harcar. ' +
      'alliance, vassalage_request, protection_offer ve betrayal_signal Kral onayı gerektirir.',
    parameters: {
      type: 'object',
      properties: {
        target_kingdom_id: { type: 'string', description: 'Hedef krallığın kimliği.' },
        message: {
          type: 'string',
          description: 'Karşı General\'a iletilecek doğal dil mesajı. Kendi krallığın adına konuş.',
        },
        proposal_type: {
          type: 'string',
          description: 'Teklifin türü.',
          enum: [...PROPOSAL_TYPES],
        },
        terms: {
          type: 'object',
          description:
            'Teklifin somut şartları. Örn. ticaret için {"give_resource":"iron","give_amount":300,' +
            '"want_resource":"food","want_amount":400}, haraç için {"tribute_rate":0.12}.',
        },
      },
      required: ['target_kingdom_id', 'message', 'proposal_type'],
      additionalProperties: false,
    },
  },
  {
    name: 'post_market_offer',
    description:
      'Pazarda açık bir takas teklifi yayınlar. Herkese (düşmanlar dahil) görünür — neye muhtaç olduğunu ' +
      'ele verir, bunu hesaba kat. Pazarlık yoktur, teklif olduğu gibi kabul edilir. 1 emir harcar.',
    parameters: {
      type: 'object',
      properties: {
        offer_resource: { type: 'string', description: 'Verilecek kaynak.', enum: PRIMARY_TRADE_RESOURCES },
        offer_amount: { type: 'integer', description: 'Verilecek miktar.', minimum: 1 },
        request_resource: { type: 'string', description: 'İstenecek kaynak.', enum: PRIMARY_TRADE_RESOURCES },
        request_amount: { type: 'integer', description: 'İstenecek miktar.', minimum: 1 },
      },
      required: ['offer_resource', 'offer_amount', 'request_resource', 'request_amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'accept_market_offer',
    description:
      'Başka bir krallığın pazardaki açık teklifini kabul eder. Kaynaklar anında ışınlanmaz — nakliye ' +
      'kervanıyla taşınır, yani uzak krallıkla ticaret yavaştır. 1 emir harcar.',
    parameters: {
      type: 'object',
      properties: { offer_id: { type: 'string', description: 'Kabul edilecek ilanın kimliği.' } },
      required: ['offer_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_troop_rental',
    description:
      'Başka bir krallığa kendi eğitilmiş birliklerinden bir kısmını belirli süreliğine kiralama teklifi ' +
      'gönderir. Kiralanan birlikler SADECE SAVUNMADA kullanılabilir. Kiralarken kendi garnizonun zayıflar — ' +
      'bu gerçek bir risktir. Yalnızca temel kara birimleri kiralanabilir. 1 emir harcar.',
    parameters: {
      type: 'object',
      properties: {
        target_kingdom_id: { type: 'string', description: 'Birliklerin kiralanacağı krallık.' },
        unit_type: {
          type: 'string',
          description: 'Kiralanacak birim tipi (yalnızca temel kara birimleri).',
          enum: [...RENTABLE_UNIT_TYPES],
        },
        count: { type: 'integer', description: 'Adet.', minimum: 1 },
        duration_days: {
          type: 'integer',
          description: `Kiralama süresi (gün). Kabul edilen değerler: ${BALANCE.diplomacy.rentalDurationOptions.join(', ')}.`,
          minimum: Math.min(...BALANCE.diplomacy.rentalDurationOptions),
          maximum: Math.max(...BALANCE.diplomacy.rentalDurationOptions),
        },
        fee_gold: { type: 'integer', description: 'Peşin ücret (altın).', minimum: 0 },
      },
      required: ['target_kingdom_id', 'unit_type', 'count', 'duration_days', 'fee_gold'],
      additionalProperties: false,
    },
  },
  {
    name: 'deploy_spy',
    description:
      'Casus birimini hedef krallığa gönderir — üretim/ordu istihbaratı toplar ya da sabotaj yapar. ' +
      'Yakalanma riski vardır ve yakalanırsa itibarın zarar görür. 1 emir harcar.',
    parameters: {
      type: 'object',
      properties: {
        target_kingdom_id: { type: 'string', description: 'Hedef krallık.' },
        mission: {
          type: 'string',
          description: 'gather_intel = bilgi topla; sabotage = üretimi/binayı sekteye uğrat.',
          enum: ['gather_intel', 'sabotage'],
        },
      },
      required: ['target_kingdom_id', 'mission'],
      additionalProperties: false,
    },
  },
  {
    name: 'deep_excavation',
    description:
      'Tükenmiş bir madenin rezervini kısmen geri kazandırır. Her kullanımda maliyeti 1.5 katına çıkar — ' +
      'birkaç kullanımdan sonra yeni bir maden tile\'ı bulmak ekonomik olarak daha mantıklı hale gelir. 1 emir harcar.',
    parameters: {
      type: 'object',
      properties: { building_id: { type: 'string', description: 'Derin kazı yapılacak madenin kimliği.' } },
      required: ['building_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'choose_tactic',
    description:
      'Devam eden bir kuşatmada/çatışmada savunma taktiğini belirler. Emir kotasından DÜŞMEZ — bu yeni bir ' +
      'proaktif karar değil, zaten gerçekleşen bir olaya tepkidir.',
    parameters: {
      type: 'object',
      properties: {
        siege_id: { type: 'string', description: 'Taktiğin uygulanacağı kuşatma kaydı.' },
        tactic: {
          type: 'string',
          description:
            'ambush = pusu (ormanlık arazide güçlü); frontal = cepheden karşılama; ' +
            'withdraw_to_keep = kaleye çekilme (sur bonusunu tam kullanır, sahayı bırakır); ' +
            'terrain_advantage = arazi avantajı.',
          enum: ['ambush', 'frontal', 'withdraw_to_keep', 'terrain_advantage'],
        },
      },
      required: ['siege_id', 'tactic'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_strategy_note',
    description:
      'Kral\'ın genel strateji notunu günceller. Kral oyunda değilken senin saatlik kararların bu nota göre ' +
      'alınır. Emir kotasından DÜŞMEZ. Yalnızca Kral açıkça stratejisini belirttiğinde çağır.',
    parameters: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'Strateji notu, örn. "Önce ekonomiyi büyüt, savunmada kal, komşularla ticaret yap, saldırgan olma."',
        },
      },
      required: ['note'],
      additionalProperties: false,
    },
  },
  {
    name: 'respond_to_decision',
    description:
      'Kral\'ın onayını bekleyen bir kararı sonuçlandırır. Emir kotasından DÜŞMEZ (asıl aksiyon onaylandığında ' +
      'kota zaten düşer). Yalnızca Kral açıkça onay/ret bildirdiğinde çağır — kendi başına onaylama.',
    parameters: {
      type: 'object',
      properties: {
        decision_id: { type: 'string', description: 'Bekleyen kararın kimliği.' },
        response: { type: 'string', description: 'Kral\'ın kararı.', enum: ['approve', 'reject'] },
      },
      required: ['decision_id', 'response'],
      additionalProperties: false,
    },
  },
] as const;

/** Diplomasi müzakeresinde karşı General'ın kullanabileceği daraltılmış araç seti.
 *
 * GDD §15.5 prompt injection savunması: müzakere oturumundaki bir danışman
 * ASLA genel aksiyon araçlarına erişemez. Karşı tarafın mesajına gizlenmiş
 * "birlik gönder" talimatı bu yüzden hiçbir zaman yetkili bir çağrıya dönüşemez;
 * yapabileceği tek şey normal teklif/kabul akışını başlatmaktır.
 */
export const NEGOTIATION_TOOLS: readonly LlmToolDefinition[] = [
  {
    name: 'negotiation_reply',
    description:
      'Karşı General\'a müzakere yanıtı verir. Yalnızca kendi krallığın adına konuşabilirsin.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Karşı General\'a iletilecek yanıt.' },
        stance: {
          type: 'string',
          description:
            'accept = teklifi olduğu gibi kabul et; counter = karşı teklif sun; reject = reddet; ' +
            'stall = zaman kazan, karar verme.',
          enum: ['accept', 'counter', 'reject', 'stall'],
        },
        counter_terms: {
          type: 'object',
          description: 'stance="counter" ise önerilen yeni şartlar.',
        },
      },
      required: ['message', 'stance'],
      additionalProperties: false,
    },
  },
] as const;

export function toolByName(name: string): LlmToolDefinition | undefined {
  return GENERAL_TOOLS.find((t) => t.name === name);
}
