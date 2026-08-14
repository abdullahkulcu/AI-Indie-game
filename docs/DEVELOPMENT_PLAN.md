# Gelistirme Plani

Bu belge iki seyi kapsar: (1) bu MVP iskeletinin hangi sirayla insa edildigi -
ayni sirayla ilerlemek, bagimliliklari doğru kurmanin en kolay yolu - ve
(2) MVP sonrasi neyin, hangi sirayla eklenecegi.

## 1. Dosya olusturma sirasi (bu iskeletin insa sirasi)

Her adim bir onceki adimin uzerine kurulur; boylece hicbir modul, henuz var
olmayan bir seye bagimli olmaz.

1. **Proje iskeleti**: root `package.json` (npm workspaces), `.gitignore`,
   `docker-compose.yml` (postgres+redis).
2. **Backend config**: `backend/tsconfig.json`, `backend/.env.example`,
   `src/config/env.ts`, `src/db/pool.ts`, `src/db/redis.ts`.
3. **Veri modelleri**: `src/models/types.ts` (Player, Tile, Unit, Resources,
   Structure, GameAction, GameStateSnapshot...), `src/db/schema.sql`,
   `src/db/migrate.ts`. Once tipler, sonra semayi tiplere gore yazmak,
   ikisinin senkron kalmasini kolaylastirir.
4. **Auth + BYOK key vault**: `src/crypto/keyVault.ts` (AES-256-GCM),
   `src/repositories/playerRepository.ts`, `src/auth/authService.ts`,
   `src/auth/authPlugin.ts`, `src/auth/authRoutes.ts`. Diger her sey bir
   `playerId`'ye ihtiyac duydugu icin auth erken gelir.
5. **Kural motoru** (`src/rules/ruleEngine.ts` + `ruleEngine.test.ts`):
   kasitli olarak simulasyondan *once* yazildi - saf, DB'siz, sadece
   `GameStateSnapshot` + `GameAction` alip `ValidationResult` donen fonksiyonlar
   oldugu icin simulasyon tasarimindan bagimsiz test edilebilir.
6. **Harita + oyun durumu + state machine**: `src/game/mapService.ts`,
   `src/game/geometry.ts`, `src/game/stateMachine.ts`,
   `src/repositories/{mapRepository,unitRepository,tickLogRepository,chatRepository}.ts`,
   `src/game/gameStateService.ts`.
7. **LLM orkestrasyonu**: `src/llm/actionSchema.ts` (tool tanimlari + zod),
   `src/llm/promptBuilder.ts`, `src/llm/openaiProvider.ts`,
   `src/llm/llmOrchestrator.ts`. Kural motoru zaten var oldugu icin, LLM
   ciktisi hangi sekle girerse girsin nasil dogrulanacagi netti.
8. **Tick dongusu + oyuncu tetiklemeli tur**: `src/game/tickService.ts`
   (`applyAction` dahil), `src/game/onboarding.ts`,
   `src/game/playerTurnService.ts`.
9. **HTTP/WS yuzeyi**: `src/routes/{mapRoutes,playerRoutes,chatRoutes}.ts`,
   `src/ws/socketServer.ts`, `src/server.ts`, `src/index.ts`.
10. **Frontend**: `frontend/package.json`, vite/tsconfig, `src/types.ts`,
    `src/api/{client,socket}.ts`, `src/components/{AuthForm,ApiKeyModal,
    MapGrid,ChatPanel,PlayerHud}.tsx`, `src/App.tsx`, `src/main.tsx`.

## 2. MVP sonrasi yol haritasi (oncelik sirasiyla)

1. **Oyun ici geri bildirim dongusu**: birim olumu/saldiri/insa olaylarinin
   frontend'de gorsel/animasyonlu bildirimi (su an sadece state snapshot'i
   yeniden ciziliyor).
2. **Coklu model sistemi**: `src/llm/openaiProvider.ts` zaten tek bir
   `requestStrategicDecision(apiKey, messages)` arayuzu etrafinda izole
   edildi. Ikinci bir saglayici eklemek icin:
   - Ayni imzaya sahip yeni bir `anthropicProvider.ts` (veya benzeri) yazin.
   - `llmOrchestrator.ts` icine `provider` parametresi ekleyip saglayiciyi
     `player_api_keys.provider` kolonuna gore secin (kolon zaten var).
3. **Yeni aksiyon tipi eklemek** (orn. `scout` / `fortify`):
   - `src/models/types.ts`: `GameAction` union'ina yeni tip ekleyin.
   - `src/llm/actionSchema.ts`: zod semasi + OpenAI tool tanimi + parse dali.
   - `src/rules/ruleEngine.ts`: `validateX` fonksiyonu + `validateAction`
     switch'ine dal + test.
   - `src/game/tickService.ts`: `applyAction` icine efekt.
4. **Odeme/abonelik sistemi**: kapsam disi kalmaya devam eder; eklenecekse
   `players` tablosuna `plan` kolonu ve ayri bir billing servisi onerilir.
5. **Tam fog of war**: su an sadece maden yataklari "yakinlik" ile
   kisitlaniyor (`mapService.findNearbyDeposits`); dusman birim/yapi
   gorunurlugu de ayni mantikla (Chebyshev mesafesi) kisitlanabilir.
6. **Otomatik acilan/kapanan kanallar**: su an sabit sayida kanal var
   (`schema.sql`'deki INSERT). Dinamik acilis/kapanis icin `channels`
   tablosuna bir `status` kolonu + kanal doluluk kontrolunde otomatik
   olusturma mantigi eklenebilir.
7. **Gelismis grafik/animasyon, mobil uyum**: kapsam disi (bkz. ana prompt).
8. **Oyuncular arasi serbest chat/diplomasi**: kapsam disi; eklenirse ayri
   bir `player_messages` tablosu + moderasyon katmani gerekir.

## 3. Bilinen MVP kisitlamalari (bilinclidir, kapsam geregi)

- Kanal sayisi sabit (3), otomatik acilip kapanmiyor - "coklu kanal" var ama
  Discord tarzi dinamik degil (bkz. yukaridaki yol haritasi maddesi).
- Harita 500x500 sabit boyutta, gercek anlamda sonsuz/chunk-bazli degil;
  terrain'in `(seed, x, y)`'nin saf fonksiyonu olmasi (bkz. `mapService.ts`)
  pratikte "sinira hicbir zaman ulasilamaz" hissini ucuza veriyor.
- Maden yatagi yogunlugu ayarlanmadi (butun dag karolari bir yatak tasiyor);
  Stronghold'daki gibi az sayida "kiymetli" maden yeri hissi icin
  `depositFor`'daki olasiliklar/terrain esikleri ayarlanabilir.
- Trade aksiyonu pazarlik icermez: iki tarafin da kaynagi varsa aninda
  gerceklesir (karsi tarafin onayi yok).
- LLM cagrisi basarisiz olursa (rate limit, gecersiz anahtar, ag hatasi) o
  oyuncunun turu sessizce atlanir; diger oyuncular ve tick etkilenmez.
- Redis, tick dongusunde tam bir Postgres-yerine-gecen state store degil;
  sadece kanal basina "guncel tick numarasi" ve kisa sureli snapshot cache'i
  icin kullanilir (bkz. `src/game/gameStateService.ts`). Bu olcekte (kanal
  basina <=8 oyuncu) her tick'te Postgres'ten tam yeniden yukleme yeterince
  ucuzdur.

## 4. Ikinci tur degisiklikler (izometrik + buyuk harita + ekonomi)

Ilk MVP'den sonra, kullanici talebiyle asagidakiler eklendi - bu, "harita
sinirsiz olsun, kanallara giren oyuncular rastgele baslasin, madencilik +
ticaretle asker basma, Stronghold Crusader'a yakin bir his" istegine cevaben
yapildi:

- **Kanallar** (`channels` tablosu, `channelRepository.ts`,
  `routes/channelRoutes.ts`): sabit sayida lobi, her biri kendi haritasi
  (farkli seed) ve tick dongusuyle.
- **Buyuk harita, sifir bulk depolama**: `tiles` tablosu kaldirildi, yerine
  sadece sahiplik iddialarini tutan `tile_claims` geldi; terrain/maden
  `mapService.terrainFor`/`depositFor` ile hesaplanir - hem backend hem
  frontend (`frontend/src/game/terrainMap.ts`) ayni algoritmayi calistirir.
  Bu yuzden harita boyutu (500x500) network/DB maliyetine hemen hemen hic
  yansimaz.
- **Rastgele baslangic konumu**: `mapService.randomStartingPosition` -
  diger oyunculardan en az bir minimum mesafede rastgele bir duz arazi
  karosu secer (mesafe gereksinimini kademeli gevseterek).
- **Madencilik**: `mine` yapi tipi, sadece bir maden yatagi (dag karosu)
  uzerine kurulabilir; her tick otomatik olarak o kaynaktan uretim yapar
  (`tickService.applyMiningIncome`).
- **Asker basma**: `recruit` aksiyonu - sahip olunan bir kislada altin+yiyecek
  harcayarak yeni bir army birimi egitir.
- **Kamera/viewport**: `MapGrid.tsx` artik butun haritayi degil, oyuncunun
  konumu etrafinda pannable (surukle-birak + yon butonlari) bir pencere
  render ediyor - 500x500'luk bir izometrik haritayi tek seferde cizmek
  pratik olmadigi icin.

## 5. Ucuncu tur degisiklikler (bolgeli harita + buyutulmus olcek + duz/vektor sanat)

Kullanicinin "harita Stronghold Crusader'a benzesin, farkli bolgeler olsun,
daha buyuk bir harita olsun, elementler/assetler daha buyuk olsun" istegine,
ve ardindan "pixel art kavramindan cikalim, duz/vektor bir gorunume gecelim"
yonlendirmesine cevaben:

- **Harita boyutu** 300x300'den 500x500'e cikarildi.
- **Bolgeli (biome) terrain uretimi** (`mapService.ts`/`terrainMap.ts`): iki
  katmanli deger gurultusu (value noise) - genis olcekli, yumusak bir "bolge"
  siniflandirmasi (`desert`/`grassland`/`highlands`, col-agirlikli) artik
  hangi ince-detay terrain paletinin kullanilacagini belirliyor; bu sayede
  harita, komsu tile'lari rastgele degil, cografi olarak tutarli buyuk
  bolgeler (collar, otlaklar, kayalik yaylalar) halinde degisiyor. Collerde
  vaha (`oasis`) noktalari ayri bir gurultu katmaniyla ayrica isaretleniyor.
  Maden yataklari sadece `mountain` terrain'inde bulunuyor ve `highlands`
  bolgesinde daha yogun kumelenip Stronghold'daki gibi "kiymetli, sinirli
  bolge" hissi veriyor.
- **Gorsel stilde tam degisim - pixel art'tan duz/vektor sanata**: bu ortamda
  internetten hazir asset indirmek mumkun degil (kenney.nl, opengameart.org,
  itch.io gibi siteler ag politikasi tarafindan 403 ile engelleniyor; npm
  registry'de de sadece tekil ikon paketleri var, tam bir izometrik
  tile/bina/karakter seti yok) - bu nedenle kullanicinin "pixel art'tan
  cikalim" talebi, tum `frontend/src/pixelart/` modulunun (tiles.ts,
  sprites.ts) prosedurel olarak "big pixel" ASCII-art rasterlemesi yerine duz,
  yumusak kenarli vektor sekillerle (gradyanli izometrik karo dolgulari,
  `roundRect`/`arc`/quadratic egrilerle cizilen bina-birim-dekorasyon
  parcalari) yeniden yazilmasiyla karsilandi. `asciiSprite.ts` kaldirildi,
  yerine `canvasTexture.ts` (texture cache) ve `shapes.ts` (paylasilan
  golge/blob/bayrak yardimcilari) geldi. Hicbir dis asset dosyasi
  kullanilmiyor - her sey hala versiyon kontrolundeki kod.

## 6. Kritik oyun ici bulgu ve duzeltme: birimler hic hareket edemiyordu

Kullanicinin asil onceligi ("asker basabildigin, savasa bildigin oynanabilir
bir strateji oyunu") dogrultusunda savas dongusunu incelerken, MVP'nin ilk
gunden beri var olan yapisal bir bosluk bulundu: `attack` fonksiyonu sadece
iki birim ZATEN bitisik karedeyken calisiyor, ama LLM'e birimi haritada
hareket ettirecek hicbir fonksiyon saglanmiyordu. `AssignedTask`/otonom FSM
(patrol/raid/hold_position/escort_trade) veri modeli ve `stateMachine.ts`
zaten mevcuttu, hatta `unitRepository.assignTask` fonksiyonu bile yazilmisti
- ama hicbir yerden cagrilmiyordu. Sonuc: oyuncular sinirsiz asker
basabilirdi ama o askerler dogdugu kareden asla ayrilamiyordu, yani rakiple
karsilasmak/savasmak fiilen imkansizdi (haritanin 500x500 buyuklugu ve
oyuncular arasi rastgele baslangic mesafesi dusunulunce).

Duzeltme:
- Yeni `assign_task` GameAction/LLM fonksiyonu eklendi (`types.ts`,
  `ruleEngine.ts::validateAssignTask`, `actionSchema.ts`, `tickService.ts`) -
  LLM artik bir birimi hedef bir kareye yurutebilir ('patrol': git ve bekle,
  saldirmaz; 'raid': git, yol uzerinde menzile giren dusmana otomatik
  saldir; 'hold_position': oldugu yerde kal; 'escort_trade': bir birimi
  takip et).
- `unitRepository.assignTask` duzeltildi: onceden state'i her zaman 'idle'
  yapiyordu (bu yuzden `advanceAutonomousUnits` gorevi hic islemezdi, cunku
  o fonksiyon sadece state === 'executing_task' oldugunda gorev calistirir);
  artik gorev atanirken state 'executing_task' oluyor.
- Hareket hizi (`geometry.ts::UNIT_MOVE_SPEED`) tick basina 1 kareden 4
  kareye cikarildi - 500x500'luk haritada oyuncular onlarca-yuzlerce kare
  uzakta baslayabildigi icin 1 kare/tick'te bir catismaya ulasmak
  pratikte saatler surerdi.
- Sistem promptu (`promptBuilder.ts`) guncellendi: LLM'e `attack`'in sadece
  bitisik birimlerde calistigi ve once `assign_task` ile mesafe kapatilmasi
  gerektigi acikca anlatiliyor; ayrica hardcoded "300x300" yerine gercek
  `state.mapSize` kullanilacak sekilde duzeltildi.
- Doğrulama: `ruleEngine.test.ts`'e `assign_task` icin 8 yeni test eklendi
  (29 test toplam, hepsi gecti); ayrica gercek `stateMachine.ts` kodu
  dogrudan calistirilarak (LLM'e ihtiyac duymadan) bir birimin raid
  gorevinden hedefe yurudugu, menzile girince otomatik dovuse basladigi ve
  dovusun bir tarafin olumune kadar dogru ilerledigi uctan uca dogrulandi;
  `unitRepository.assignTask`'in gercek Postgres'e dogru persist ettigi
  (state/assigned_task/target_unit_id) ayrica test edildi.

## 7. Populasyona gore buyuyen harita + varsayilan yaban mob'lar

Kullanicinin "harita birileri katilinca mi genisleyecek, birde default olarak
her kanalda 4-5 mob olsun" isteklerine cevaben:

- **Populasyona gore buyuyen harita** (`mapService.mapSizeForPlayerCount`,
  `channelRepository.growMapSize`): bir kanal artik ilk katilimda 500x500'un
  tamamini acmiyor - `map_size = min(500, 100 + oyuncu_sayisi * 50)` formuluyle
  kucuk baslayip (100x100, 1 oyuncu icin 150x150) her yeni katilimda buyuyor,
  8 oyuncuda (kanalin maksimumu) tam 500x500'e ulasiyor. `growMapSize`
  `GREATEST` kullanir, yani hicbir zaman kuculmez; zaten yerlestirilmis
  yapi/birimler etkilenmez (harita buyumesi sadece yeni baslangic/insa
  sinirini genisletir, terrain fonksiyonu zaten sinirsizdi). Dogrulama:
  gercek API uzerinden ardisik iki oyuncu katilimi ile `channels.map_size`'in
  100 -> 150 -> 200 sekilde buyudugu Postgres'te dogrudan gozlemlendi.
- **Varsayilan yaban mob'lar** (`mobService.ts`, yeni `unitRepository.
  countAliveMobs`): her kanalda her zaman ~5 sahipsiz (`owner_player_id =
  NULL`), dusmanca birim ("mob") bulunur - `runTick` her calistiginda
  `ensureChannelMobs` canli mob sayisini hedefe tamamlar, yani oldurulen
  mob'lar otomatik yenileniyor. Mob'lar oyuncuyu aramaz, sadece saldirilirsa
  karsilik verir (mevcut otonom FSM/auto-retaliation degismeden calisir -
  sahiplik kontrolu yapmiyordu zaten). Bu, baska bir oyuncuya ulasamadan once
  bile "asker basip savasilacak bir sey" saglar. `units.owner_player_id`
  sutunu NULL'a izin verecek sekilde genisletildi (schema.sql'e idempotent
  `ALTER TABLE ... DROP NOT NULL` eklendi); rule engine/LLM tarafinda ekstra
  degisiklik gerekmedi çünkü butun sahiplik kontrolleri zaten `ownerPlayerId
  === playerId` sekilinde - null bir mob'u otomatik olarak "dusman" yapiyor.
  Frontend'de mob'lar icin ayri, hesap rengi kullanmayan sabit bir "vahsi"
  sprite (kukuletali, kirmizi gozlu, sopali siluet) eklendi. Dogrulama:
  gercek Postgres'e karsi mob sayisinin 5'e tamamlandigi ve tarayicida
  ayirt edilebilir sekilde render edildigi goruldu.

## 8. Gorsel detay artisi (Stronghold Crusader'a "yakinlik" talebi)

Kullanici "pixel olmasina gerek yok ama Stronghold Crusader grafiklerine
yakin olsun" dedi. Gercekci beklenti yonetimi: Stronghold'un gorunumu
profesyonel sanatcilarin aylarca elle boyadigi/render ettigi yuksek
cozunurluklu spritelardan geliyor - bu, kodla gercek zamanli sekil ciziminden
temelde farkli bir surec ve birebir yakalanamaz; ayrica bu ortamda internetten
hazir asset indirmek de mumkun degil (bkz. bolum 6/agent notlari). Bunun
yerine mevcut duz/vektor prosedurel motor, "boyali/dokulu, detayli" yone
mumkun oldugunca itildi:

- **Boyali zemin dokusu** (`shapes.ts::speckleTexture`): her tile artik duz
  gradyan degil, hash-tabanli, deterministik bir benek/leke dokusu tasiyor
  (karo diamond'ina clip'lenmis), artı ust-sol'da ince bir isik/alt-sag'da
  golge cizgisi - duz vektor gorunumden "boyanmis yuzey" hissine gecis.
- **Bina detaylari**: `base` yapisina pencereler (sicak isikli, cerceveli),
  bacadan yukselen duman (`shapes.ts::chimneySmoke`), kapi cercevesi ve
  catida "kiremit/saman siralari" (`roofShingleLines`) eklendi; `barracks`
  kulelerine ok mazgallari ve duvar dokusu; `mine`/`sawmill`/`market`
  duvarlarina/tezgahina doku ve fici gibi ek dekor; `farm`a cit direkleri.
  Tum duz renkli duvar/tezgah yuzeyleri artik `wallTexture` ile dokulu.
- **Birim detaylari**: asker (`army`) artik omuzlardan sarkan bir pelerin ve
  ust uste 3 zirh plakasi cizgisiyle daha katmanli gorunuyor.
- Dogrulama: 6 yapi tipi + 3 asker + 1 kervan + 5 mob'un hepsinin ayni anda
  goruldugu bir "uzun sureli oynanmis" sahne kurulup ekran goruntusu alindi;
  yakin plan kirpma ile pencere/baca/mazgal/fici/pelerin detaylari teker
  teker dogrulandi.
