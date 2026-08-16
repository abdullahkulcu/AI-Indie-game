/**
 * Denge sabitleri.
 *
 * Formüllerin içine gömülü sihirli sayılar yerine tek bir tabloda toplanır;
 * GDD §16.5 gereği bir channel başladığı kural setiyle biter, bu yüzden bu
 * değerler channel oluşturulurken anlık görüntü olarak saklanabilir.
 */

export const BALANCE = {
  /** Tick servisi kaç saniyede bir uyanır (§15.3). */
  tickIntervalSeconds: 60,

  // ------------------------------------------------------------- Kaynaklar
  resources: {
    /** Ambar yokken bile var olan taban depolama kapasitesi. */
    baseStorageCapacity: 1500,
    /** Kale seviyesi başına eklenen depolama. */
    storagePerKeepLevel: 900,
    /** Altın depolamada sınırsızdır (hazine ayrı tutulur). */
    unlimitedStorage: ['gold'] as const,
    /** Vergi oranı %100 iken nüfus başına saatlik altın. */
    goldPerCapitaAtFullTax: 0.11,
    /** Nüfus başına saatlik yiyecek tüketimi. */
    foodPerCapitaPerHour: 0.05,
    /** Peynir stoğunun saatlik doğal tüketim oranı (lüks tüketim). */
    cheeseDecayPerHour: 0.02,
  },

  // ----------------------------------------------------------- Maden (§4.1)
  mine: {
    /** Sv.1 maden rezervi; her seviye bunun katı kadar rezerv taşır. */
    reservePerLevel: 50_000,
    /** Bu oranın altına inince üretim doğrusal olarak sıfıra yaklaşır. */
    taperThreshold: 0.2,
    /** Derin kazı: orijinal rezervin bu oranı kadar geri ekler. */
    deepExcavationRefundRatio: 0.4,
    /** Derin kazının ilk maliyeti (altın). */
    deepExcavationBaseCost: 500,
    /** Her kullanımda maliyet bu katsayıyla çarpılır (500 → 750 → 1125...). */
    deepExcavationCostFactor: 1.5,
  },

  // --------------------------------------------------- Popülerlik/nüfus (§6)
  popularity: {
    /** Popülerliğin çekildiği denge noktası; tüm etkiler bunun etrafında toplanır. */
    neutral: 50,
    /** Popülerlik hedefe saatte bu oranda yaklaşır (ani sıçrama olmaz). */
    approachRatePerHour: 0.25,
    /** Vergi oranı %'sinin popülerliğe etkisi: -taxWeight × (oran - taxNeutralRate). */
    taxWeight: 0.55,
    taxNeutralRate: 20,
    /** Yiyecek fazlası/açığının etkisi (nüfus başına günlük fazla üzerinden). */
    foodSurplusWeight: 26,
    foodShortagePenalty: 45,
    /** Nüfus başına günlük bira arzının etkisi (üst sınırlı). */
    aleWeight: 30,
    aleCap: 14,
    /** Nüfus başına günlük peynir arzının etkisi (üst sınırlı). */
    cheeseWeight: 14,
    cheeseCap: 6,
    /** Son 24 saatteki her savaş kaybı başına düşüş. */
    defeatPenalty: 6,
    /** Savunma zaferi başına artış. */
    defenseVictoryBonus: 5,
    /** Saldırı zaferi başına artış. */
    attackVictoryBonus: 2,
    /** Aktif kuşatma altındayken saatlik düşüş. */
    underSiegePenaltyPerHour: 1.5,
    /** Bu eşiğin altında göç ve üretim yavaşlaması başlar. */
    migrationThreshold: 20,
    /** Bu eşiğin altında isyan riski doğar. */
    revoltThreshold: 12,
    /** Eşiğin altındaki her saat için isyan olasılığı (0-1). */
    revoltChancePerHour: 0.06,
  },

  population: {
    /** Popülerlik 100 iken saatlik büyüme oranı. */
    maxGrowthRatePerHour: 0.022,
    /** Popülerlik `neutral` altındayken saatlik küçülme oranı (en kötü hâlde). */
    maxDeclineRatePerHour: 0.03,
    /** Meydan yokken taban nüfus tavanı. */
    baseCap: 120,
    /** Kapasitenin bu oranına yaklaşınca büyüme yavaşlar (lojistik eğri). */
    softCapRatio: 0.85,
    /** Yiyecek açığı varken büyüme tamamen durur. */
    requireFoodSurplus: true,
  },

  /** Şenlik/Ziyafet — GDD §6.2. */
  festival: {
    cost: { food: 220, ale: 90, gold: 260 },
    /** İlk şenlikte anlık popülerlik artışı. */
    basePopularityBoost: 14,
    /** Bonusun süresi (saat). */
    bonusDurationHours: 72,
    /** Süre boyunca popülerlik hedefine eklenen "mutlu halk" bonusu. */
    lingeringBonus: 6,
    /** Aynı hafta içindeki her tekrar bu katsayıyla çarpılır (azalan getiri). */
    diminishingFactor: 0.5,
    /** Azalan getirinin sıfırlanma penceresi (saat). */
    windowHours: 168,
  },

  // ------------------------------------------------------------ Savaş (§8)
  combat: {
    /**
     * Bir çatışmanın kuşatmaya dönmesi için gereken eşikler. İkisinden biri
     * sağlanırsa çok-tick'li kuşatma başlar (§8.2).
     */
    siegeArmySizeThreshold: 60,
    siegeWallLevelThreshold: 1,
    /** Kuşatma round'ları arası süre (saniye). */
    siegeRoundIntervalSeconds: 3 * 3600,
    /** Bir kuşatmanın çözülmeden sürebileceği azami round sayısı. */
    siegeMaxRounds: 16,
    /** Round başına taban kayıp oranı (güç oranına göre ölçeklenir). */
    baseCasualtyRate: 0.16,
    /** Anlık akınlarda kayıp oranı daha yüksektir (tek seferde çözülür). */
    raidCasualtyRate: 0.34,
    /** Kazananın kayıpları, kaybedenin kayıp oranının bu katıdır. */
    winnerCasualtyRatio: 0.42,
    /** Güç oranının kayıplara etkisini yumuşatan üs (Lanchester benzeri). */
    powerRatioExponent: 1.4,
    /** Savunma tarafındaki yapı bonusunun ölçeği. */
    fortificationScale: 1.0,
    /** Kuşatma birimi olmayan ordunun sura verdiği hasar çarpanı. */
    noSiegeEquipmentPenalty: 0.06,
    /** Hendeğin koçbaşı/merdivenciye karşı etkinlik kırma oranı (seviye başına). */
    moatSiegeReductionPerLevel: 0.12,
    /** Yağmada depodan alınabilecek azami oran. */
    maxPlunderRatio: 0.35,
  },

  /** Taktik çarpanları — GDD §8.3. */
  tactics: {
    ambush: { attack: 0.85, defense: 1.28, note: 'Ormanlık/engebeli arazide savunanı belirgin güçlendirir.' },
    frontal: { attack: 1.15, defense: 1.0, note: 'Saldırıda dengeli, savunmada nötr.' },
    withdraw_to_keep: { attack: 0.6, defense: 1.45, note: 'Sur/kale bonusunu tam kullanır ama sahayı bırakır.' },
    terrain_advantage: { attack: 0.95, defense: 1.22, note: 'Arazi savunma çarpanını ikinci kez uygular.' },
  },

  /** Moral — popülerlikten beslenir (§8.3). */
  morale: {
    /** Popülerlik 0 iken moral çarpanı. */
    min: 0.7,
    /** Popülerlik 100 iken moral çarpanı. */
    max: 1.25,
    /** Kilise seviyesi başına moral tabanına eklenen değer. */
    chapelBonusPerLevel: 0.015,
  },

  /** Yorgunluk — mesafeye bağlı kademeli ceza (§8.3). */
  fatigue: {
    /** Bu tile mesafesine kadar ceza yok. */
    freeDistanceTiles: 8,
    /** Eşikten sonraki her tile için güç kaybı. */
    penaltyPerTile: 0.012,
    /** Güç çarpanının inebileceği en düşük değer. */
    minMultiplier: 0.55,
    /** Eşik ötesindeki her tile için ek erzak tüketimi katsayısı. */
    extraUpkeepPerTile: 0.04,
  },

  // ----------------------------------------------------- Nakliye kervanı (§9)
  caravan: {
    /** Sefer başına taşıma kapasitesi. */
    capacityPerTrip: 200,
    /** Kervanın tile başına yol süresi (saniye). */
    secondsPerTile: 900,
    /** Bir kervan seferinin altın maliyeti. */
    goldCost: 20,
  },

  // ------------------------------------------------------- Diplomasi (§10)
  diplomacy: {
    reputation: {
      start: 60,
      /** Vasalını savunmasız bırakmak. */
      abandonedVassal: -14,
      /** Ateşkesi bozmak. */
      brokeCeasefire: -20,
      /** İttifakı terk etmek / ihanet. */
      betrayedAlliance: -25,
      /** Kiralık birlikleri kuşatma sırasında geri çağırmak (§10.5). */
      earlyRecallDuringSiege: -12,
      /** Ticaret anlaşması teslimatını habersiz durdurmak (§10.6). */
      brokeTradeAgreement: -10,
      /** Müttefikin/vasalın yardımına gitmek. */
      cameToAid: +8,
      /** Bir taahhüdü süresi boyunca eksiksiz tamamlamak. */
      keptPromise: +5,
      /** Adil ticaret (tamamlanan pazar/anlaşma teslimatı). */
      fairTrade: +2,
      /** İtibar zamanla bu değere doğru çok yavaş döner. */
      driftTarget: 55,
      driftPerDay: 0.4,
    },
    /**
     * Karşı danışmanın bir teklifi değerlendirirken uyguladığı itibar eşiği.
     * Bu değerin altındaki krallıkların teklifleri "güvenilmez" etiketiyle sunulur.
     */
    lowReputationThreshold: 35,
    /** Vasallık haraç oranı: vasalın saatlik üretiminin bu kadarı koruyucuya akar. */
    defaultTributeRate: 0.12,
    /** Haraç aktarımının periyodu (saat). */
    tributeIntervalHours: 6,
    /** Birlik kiralama için standart süre seçenekleri (gün). */
    rentalDurationOptions: [3, 7, 14],
    /** Bölgesel duyum akışı bülten periyodu (saat, §10.4). */
    regionBulletinIntervalHours: 6,
    /** "Bölge" tanımı: başkente bu tile mesafesi içindeki krallıklar. */
    regionRadiusTiles: 30,
  },

  /** Pazar — GDD §10.6. */
  market: {
    /** Pazar yokken bile açık tutulabilen ilan sayısı (0 = pazar şart). */
    baseOfferSlots: 0,
    /** Bir ilanın kendiliğinden düşme süresi (saat). */
    offerExpiryHours: 48,
  },

  // ------------------------------------------------- Emir kotası (§14.4)
  decreeQuota: {
    /** Kullanılmayan kota en fazla kaç saatlik birikebilir. */
    maxRolloverHours: 2,
    /** Kotayı tüketen aksiyonlar. */
    quotaConsumingActions: [
      'build_structure',
      'train_unit',
      'move_army',
      'set_tax_rate',
      'send_diplomacy_message',
      'deploy_spy',
      'send_caravan',
      'host_festival',
      'post_market_offer',
      'accept_market_offer',
      'propose_troop_rental',
      'hire_mercenaries',
      'deep_excavation',
    ] as const,
  },

  // ------------------------------------------- Kral–General ilişkisi (§14.5)
  general: {
    loyaltyStart: 75,
    /** Kral ısrar edip riskli emri uygulattığında düşüş. */
    loyaltyDropOnForcedRiskyOrder: 8,
    /** Felaket düzeyinde bir emirde ek düşüş. */
    loyaltyDropOnCatastrophicOrder: 16,
    /** Makul bir emirde kazanılan sadakat. */
    loyaltyGainOnSoundOrder: 1.5,
    /** Sadakat bu değerin altındayken General emirleri geciktirir. */
    sluggishThreshold: 40,
    /** Sadakat bu değerin altındayken nadiren açıkça reddeder. */
    defiantThreshold: 20,
    /** Düşük sadakatte emrin uygulanmasına eklenen gecikme (saniye). */
    sluggishDelaySeconds: 20 * 60,
    /** `defiantThreshold` altında bir emrin reddedilme olasılığı. */
    refusalChance: 0.25,
    /** Onay bekleyen büyük kararın zaman aşımı (saat) — sonra güvenli seçenek uygulanır. */
    pendingDecisionTimeoutHours: 12,
    /** Krallığın "pasif" sayılması için gereken sessizlik süresi (dakika). */
    passiveAfterMinutes: 45,
    /**
     * Bir aksiyonu "büyük/riskli" yapan eşikler (§14.5). Bunlardan biri
     * aşılırsa General otomatik uygulamaz, Kral'ın onayını bekler.
     */
    majorDecisionThresholds: {
      /** Hazinenin bu oranından fazlasını harcamak. */
      treasuryShare: 0.5,
      /** Garnizonun bu oranından fazlasını sefere çıkarmak. */
      garrisonShare: 0.6,
      /** Savaş ilanı / saldırı niyeti her hâlükârda büyük karardır. */
      offensiveIntents: ['attack'] as const,
      /** Kalıcı taahhüt doğuran diplomatik teklifler. */
      bindingProposals: [
        'alliance',
        'vassalage_request',
        'protection_offer',
        'betrayal_signal',
      ] as const,
    },
  },

  // ------------------------------------------------------ Dünya olayları (§11)
  worldEvents: {
    /** Bir krallığın olay çekme kontrolü kaç saatte bir yapılır. */
    checkIntervalHours: 24,
    /** Kontrol başına olay çıkma olasılığı. */
    chancePerCheck: 0.22,
    /** Aynı krallığa iki olay arasındaki asgari süre (saat). */
    cooldownHours: 72,
    weights: {
      bountiful_harvest: 30,
      plague: 20,
      bandit_raid: 28,
      traveling_merchant: 22,
    },
    bountifulHarvest: { foodMultiplier: 1.5, durationHours: 24 },
    plague: { populationLoss: 0.12, popularityDrop: 10, durationHours: 48 },
    banditRaid: { armyScale: 0.25, minPower: 200 },
    travelingMerchant: { rateBonus: 1.35, durationHours: 12 },
  },

  // --------------------------------------------- Yeni oyuncu koruması (§13)
  protection: {
    durationHours: 96,
    /** Koruma bitmeden bu kadar saat önce uyarı gider. */
    warningBeforeHours: 24,
    /** Koruma altındayken saldırı seferi çıkarılabilir mi. */
    canAttackWhileProtected: false,
  },

  // ------------------------------------------------------------ Channel (§16)
  channel: {
    defaultSeasonDays: 75,
    /** Harita dairesel olarak dışa büyür; halka başına tile yarıçapı artışı. */
    ringRadiusStep: 6,
    /** Bir halkaya sığan krallık sayısı yarıçapla orantılı artar. */
    slotsPerRingBase: 6,
    /** Başlangıç krallığının kontrol ettiği tile yarıçapı. */
    startingTerritoryRadius: 1,
  },
} as const;

export type BalanceConfig = typeof BALANCE;
