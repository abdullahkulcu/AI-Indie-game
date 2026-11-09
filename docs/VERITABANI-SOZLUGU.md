# Demirkale veritabanı sözlüğü

Tarih: 2026-11-06
Kaynak: `db/schema.ts` (PostgreSQL / Drizzle)

Bu belge, uygulamanın kullandığı 28 kalıcı tabloyu oyun diliyle açıklar. Oyun
durumunun tamamı her tabloya bölünmez: bir krallığın kaynakları, binaları,
nüfusu ve birlikleri `game_saves.game_state` içinde tek sürümlü kayıt olarak
tutulur; ortak ve sunucu sahipli olaylar ise ayrı tablolardadır.

## Okuma anahtarı

- `id`, `user_id`, `channel_id` gibi alanlar kimliği ve ilişkiyi taşır.
- `..._at` alanlarının çoğu epoch milisaniyesidir; `created_at` gibi kayıt
  zamanları PostgreSQL `timestamptz` alanıdır.
- Bazı JSON verileri (`game_state`, `voices`, `units`, `loot`, `terms` vb.)
  metin alanında saklanır; yapısı ilgili motor/sunucu kodunda doğrulanır.
- `encrypted_key`, `iv`, `password_hash` değerleri güvenlik verisidir. Bu
  alanların değeri asla kullanıcı arayüzüne, loglara veya bu belgeye yazılmaz.

## İlişki özeti

```text
users ──< sessions
  │  └──< game_saves / llm_credentials / intel_defenses
  │  └──< general_* / populace_demands / council_briefings
  │  └──< wars / negotiations / agreements
  └──< channel_members >── channels
                         └──< ortak dünya, istihbarat, savaş ve diplomasi kayıtları
```

## 1. Hesap, oturum ve dünya

### `users` — oyuncu hesabı

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id` | Kullanıcının birincil kimliği. |
| `email`, `display_name` | Giriş adresi ve ekranda görünen isim. |
| `password_hash` | Parolanın tek yönlü hash'i; parola değil. |
| `role` | `player` veya tekil `admin`. |
| `status` | Hesabın `active` / `inactive` durumu. |
| `created_at`, `last_login_at` | Hesap açılışı ve son giriş zamanı. |

`email` benzersizdir. Veritabanı aynı anda ikinci bir admin oluşturulmasını da
kısmi benzersiz indeks ile engeller.

### `sessions` — giriş oturumları

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `token_hash` | Çerezdeki oturum token'ının hash'i; birincil anahtar. |
| `user_id` | Oturumun sahibi. |
| `expires_at` | Oturumun geçerlilik bitişi. |
| `created_at` | Oturumun açılış zamanı. |

### `channels` — oyun dünyası / sezon

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `name`, `slug` | Dünyanın kimliği, adı ve URL/benzersiz kısa adı. |
| `status` | Dünyanın `active` / `inactive` olması. |
| `speed` | Oyun zamanının hızı. |
| `duration_days`, `max_players` | Sezon uzunluğu ve oyuncu kapasitesi. |
| `starts_at`, `ends_at` | Dünya başlangıç ve opsiyonel bitiş zamanı. |
| `created_by`, `created_at` | Dünyayı açan kullanıcı ve kayıt zamanı. |

### `channel_members` — oyuncunun dünyadaki üyeliği

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `user_id`, `channel_id` | Oyuncu–dünya birleşik birincil anahtarı. |
| `status` | Üyeliğin aktifliği. |
| `accepts_negotiation` | Diğer krallıkların bu kralla masa açabilip açamayacağı. |
| `accepts_agitation` | Eski sürümden kalan uyumluluk alanı; uygulama artık bunu kullanmaz. |
| `joined_at` | Dünyaya katılım zamanı. |

## 2. Krallığın ana kaydı ve AI kimlikleri

### `game_saves` — krallığın tek kaynak kaydı

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `user_id` | Krallığın sahibi; bir kullanıcı için tek kayıt. |
| `game_state` | Kaynaklar, binalar, nüfus, birlikler, kuyruklar, defter ve diğer kişisel oyun durumu. JSON metni. |
| `revision` | Aynı anda iki kaydetme isteğinin birbirini ezmesini önleyen sürüm numarası. |
| `updated_at` | Son kayıt zamanı. |

### `llm_credentials` — oyuncunun General bağlantısı

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `user_id` | General bağlantısının sahibi. |
| `provider`, `model` | LLM sağlayıcısı ve model adı. |
| `encrypted_key`, `iv`, `key_version` | Şifreli API anahtarı, şifreleme vektörü ve şema sürümü. Değerleri okunmaz/gösterilmez. |
| `created_at`, `updated_at` | Bağlantının oluşturulma ve güncellenme zamanı. |

### `populace_credentials` — Halk ve Garnizon AI bağlantıları

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id` | Kimlik satırı. |
| `channel_id` | Bağlantının geçerli olduğu dünya. |
| `user_id` | Boşsa dünya varsayılanı, doluysa sadece o krallık için özel ayar. |
| `persona` | Halk AI kişiliği. |
| `provider`, `model`, `temperature` | Sağlayıcı, model ve destekleyen sağlayıcılardaki anlatım çeşitliliği ayarı. |
| `encrypted_key`, `iv`, `key_version` | Şifreli erişim bilgisi; asla geri okunmaz. |
| `created_by`, `created_at`, `updated_at` | Ayarı yapan admin ve zaman bilgileri. |

Bir dünyada yalnız bir varsayılan, her krallık için de en fazla bir özel ayar
bulunabilir.

## 3. Diyar, istihbarat ve ortak maden

### `intel_defenses` — karşı-istihbarat

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `user_id` | Savunmanın sahibi. |
| `level` | Karşı-istihbarat seviyesi. |
| `active_until` | Savunmanın aktif kalacağı an. |
| `updated_at` | Son değişiklik zamanı. |

### `intel_missions` — ajan/keşif görevleri

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `channel_id` | Görev ve dünya kimliği. |
| `source_user_id`, `target_user_id` | Ajanı yollayan ve hedef krallık. |
| `kind` | `scout` normal keşif, `deep_observation` ise daha pahalı/riskli halk ruh hâli görevi. |
| `status` | `pending`, `succeeded`, `failed` veya `detected`. |
| `success_chance`, `detection_chance` | Görev anında hesaplanan başarı ve fark edilme ihtimali. |
| `completes_at` | Görevin sonuçlanma zamanı. |
| `report` | Sonuç raporu; yapılandırılmış metin/JSON. |
| `created_at`, `resolved_at` | Gönderilme ve sonuçlanma kaydı. |

Bir kaynak–hedef çifti için aynı anda sadece bir bekleyen ajan olabilir.

### `spy_networks` — kalıcı casus ağı

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `channel_id` | Ağ ve ait olduğu dünya. |
| `source_user_id`, `target_user_id` | Ağı kuran Kral ve hedef krallık; isimler hiçbir kuralda kimlik yerine kullanılmaz. |
| `status` | `deploying`, `active`, `exposed` veya ileride geri çağrılmış `recalled`. |
| `deploys_at` | Ağın hedefte yerleşeceği oyun zamanı. |
| `next_report_at`, `last_report_at` | Bir sonraki ve son düzenli istihbarat raporunun zamanı. |
| `latest_report` | Sadece gönderenin okuduğu, kamuya açık alanlardan üretilen son rapor JSON'u. |
| `exposed_at`, `created_at` | Karşı-istihbaratın hattı açığa çıkardığı ve ağın kurulduğu zaman. |

Aynı kaynak–hedef çifti için kurulmakta veya etkin yalnız bir ağ bulunabilir.

### `shared_mines` — dünya ortak madeni

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `channel_id`, `name` | Madenin kimliği, dünyası ve aktif damar adı. |
| `vein`, `position_x`, `position_z` | Damar sırası ve Diyar haritasındaki konumu. Damar bitince bu kayıt tükendi olarak kalır; yeni saha/fırsat doğurma sonraki dünya olayı çalışmasıdır. |
| `ore_remaining`, `extracted_ore` | Kalan ve toplam çıkarılmış cevher. |
| `last_tick_at`, `created_at` | Son üretim hesabı ve açılış zamanı. |

Her dünya için tek **aktif** ortak maden bulunur. Damar tükenince eski ekip köyüne döner ve yeni saha haritada belirir; yeni sahaya işçi yeniden atanır.

### `shared_mine_workers` — madendeki krallık payı

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `mine_id`, `user_id` | Maden–krallık birleşik kimliği. |
| `workers` | Madene atanmış işçi sayısı. |
| `pending_ore` | Çıkarılmış fakat henüz krallık ambarına teslim edilmemiş kesirli cevher. |
| `delivered_ore`, `last_delivery_at` | Teslim edilmiş toplam ve son teslim zamanı. |
| `joined_at` | Madene katılım zamanı. |

## 4. General, halk ve Divan

### `standing_orders` — Generalin kalıcı emirleri

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `user_id`, `channel_id` | Emir, kral ve dünya kimlikleri. |
| `instruction` | Kralın verdiği kalıcı talimat. |
| `autonomy` | Generalin kendi başına uygulaması (`autonomous`) veya onay istemesi (`ask`). |
| `status` | `pending_approval`, `active`, `paused`. |
| `max_actions_per_wake`, `daily_action_cap`, `actions_today` | Tek çalışma turu/gün için eylem sınırları ve güncel sayaç. |
| `day_started_at`, `last_run_at`, `last_outcome` | Günlük sayaç başlangıcı, son çalışma ve sonuç özeti. |
| `created_at` | Emrin veriliş zamanı. |

### `pending_decisions` — kral onayı bekleyen riskli emir

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `user_id` | Kral; bir kral için aynı anda tek bekleyen karar. |
| `action`, `reasons` | Önerilen işlem ve Generalin gerekçesi. |
| `risk_level` | `elevated` veya `severe` risk seviyesi. |
| `people_pulse` | Teyit öncesi gösterilen nitel halk tepkisi; puan, yüzde veya ham halk verisi içermez. |
| `expires_at`, `created_at` | Kararın son geçerlilik ve açılış zamanı. |

### `general_ledger` — Generalin kalıcı hafızası

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `user_id`, `kind` | Kral ve hafıza olayı birleşik kimliği. |
| `weight` | Aynı olayın tekrar sayısı/ağırlığı. |
| `first_seen_at`, `last_seen_at` | Olayın ilk ve son görülme zamanı. |

### `general_requests` — Generalin açık talepleri

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `user_id`, `kind` | Kral ve talep türü birleşik kimliği. |
| `text` | Talebin kral için açıklaması. |
| `severity` | `normal` veya `urgent`. |
| `raised_at` | Talebin ilk açıldığı an. |

### `populace_demands` — Halkın ve garnizonun talepleri

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `user_id`, `kind` | Kral ve talep türü birleşik kimliği. |
| `voice` | Talebin sahibi: `commons` veya `garrison`. |
| `text` | Kralın gördüğü talep cümlesi; AI yanıtı için önbellek görevi de görür. |
| `tone`, `severity` | Söyleyiş sertliği ve aciliyet. |
| `seen_at`, `opened_at` | Koşulun ilk fark edilişi ve talebin gerçekten açılışı. |
| `last_notice_at` | Son bildirim zamanı. |

### `populace_feed` — meydan güncesi

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `user_id`, `channel_id` | Günce satırı, sahibi krallık ve ait olduğu channel. |
| `kind` | Günlüğün tetikleyici bağlamı: geçim, inşaat, garnizon, muhalefet, dünya veya anonim komşu söylentisi. |
| `text` | Halk-AI'nın ürettiği atmosferik kısa cümle; talep, emir veya oyun sonucu değildir. |
| `source_key` | Aynı cron penceresinde aynı gündemin iki kez yazılmasını engelleyen anahtar. |
| `created_at` | Satırın cron tarafından üretildiği an. |

### `referendums` — halk oylaması sonuçları

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `user_id` | Oylama kaydı ve sahibi krallık. |
| `topic`, `question` | Genel aracılığıyla sorulan vergi veya istihkak konusu ve oyuncunun gördüğü soru. |
| `support`, `verdict` | Oyun durumundan türetilmiş destek yüzdesi ile destekliyor/bölünmüş/karşı sonucu. |
| `text` | Halk-AI'nın yalnız sonucu açıklayan kısa sözü; oyun kuralını veya sonucu değiştirmez. |
| `asked_at` | Haftalık yeniden sorma sınırının dayanağı olan sorma zamanı. |

### `fate_events` — Kader anları

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `user_id`, `channel_id` | Kader olayı, sahibi krallık ve ait olduğu dünya. |
| `kind`, `source_key` | Eşik türü ve aynı channel'da aynı ikilemin ikinci kez açılmasını engelleyen sabit anahtar. |
| `title`, `text`, `discussion` | Divanda gösterilen başlık, durum anlatısı ve Generale taşınacak tartışma sorusu. |
| `status` | `open`, `discussed` veya `deferred`; olay doğrudan ferman çıkarmaz. |
| `opened_at`, `resolved_at` | Olayın doğduğu ve Kralın seçimini yaptığı an. |

### `council_briefings` — Divan gündemi

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `user_id` | Krallık; her kral için tek güncel gündem. |
| `voices` | Halk, Garnizon ve General görüşleri. JSON metni. |
| `connections` | Bu görüşlerin AI bağlantı/kural yedeği durumu. JSON metni. |
| `source_key` | Gündemin hangi oyun durumu için üretildiğini ayırt eden anahtar. |
| `generated_at`, `read_at` | Üretim ve kralın “okudum” zamanı. |
| `reminder_count` | Okunmayan gündeme kaç kez hatırlatma üretildiği. |
| `refreshing_at` | Aynı gündemi iki eşzamanlı işlemin yenilemesini engelleyen kilit zamanı. |

## 5. Dolaylı mücadele ve göç

### `agitations` — propaganda ve dolaylı mücadele operasyonları

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `channel_id` | Operasyon ve dünya kimliği. |
| `source_user_id`, `target_user_id` | Gönderen ve hedef krallık. |
| `kind` | Halk/garnizon altını, mal bolluğu veya haydut yönlendirme operasyon türü. |
| `status` | `pending`, `settled`, `exposed`. |
| `cost`, `cost_resource` | Ödenen maliyet ve kaynak türü. |
| `sent_at`, `completes_at`, `settled_at` | Gönderim, hedefe varış ve sonuçlanma zamanı. |
| `pair_window` | Aynı iki krallık arasındaki tekrar bekleme penceresi. |

### `migrations` — krallıklar arası halk göçü

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `channel_id`, `source_user_id` | Göç, dünya ve ayrılan nüfusun kaynağı. |
| `count` | Ayrılan kişi sayısı. |
| `sent_at`, `completes_at`, `settled_at` | Göçün başlama, varış ve yerleşme zamanı. |
| `status` | `pending` veya `settled`. |

Hedef krallık gönderim anında değil, göç varışında güncel boş konuta göre
seçilir.

## 6. Savaş ve sefer

### `wars` — iki taraflı seferin ana kaydı

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `channel_id` | Sefer ve dünya kimliği. |
| `attacker_id`, `defender_id` | Saldıran ve savunan krallık. |
| `objective` | `raid`, `concession`, `siege` veya açık sınır baskısı olan `blockade`. |
| `status` | `gathering` → `marching` → `engaged`/`siege`/`blockade` → `returning` → sonuç; ayrıca `cancelled`. |
| `target_terrain`, `distance`, `march_hours` | Hedef arazisi, yol uzaklığı ve oyun saatiyle sefer süresi. |
| `created_at`, `departs_at`, `arrives_at`, `returns_at` | Planın açılışı, çıkış, varış ve dönüş zamanları. |
| `siege_ends_at`, `sally_at`, `peace_offer_at` | Kuşatma sonu, tek huruç ve barış teklifi damgaları. |
| `blockade_settled_at`, `blockade_pressure` | Ablukanın son erzak hesabı ve hedefte oluşan toplam açık sınır baskısı. |
| `defender_civic_response`, `defender_morale_bonus` | Sınır tehdidinde halkın desteği/bekleyişi/barış baskısı ve bunun savunma moraline etkisi. |
| `king_leads` | Saldıran Kralın sefere katılıp katılmadığı. Cephedeki Kral ilk temasta moral verir ve kendi tarafının saha raporunu anında görür. |
| `attacker_support_morale`, `defender_support_morale` | Dış krallıkların zamanında ulaşan ikmal konvoylarından gelen sınırlı toplam moral desteği. |
| `war_points`, `outcome`, `loot`, `resolved_at` | Savaş üstünlüğü, kazanan/beraberlik, dönüşte verilecek ganimet ve sonuç zamanı. |
| `revision` | Eşzamanlı durum geçişlerini koruyan sunucu sürümü. |

Bir kralın aynı anda yalnızca bir aktif saldırısı ve bir aktif savunması
olabilir; böylece aynı birlikler iki sefere gönderilemez.

Sefer ilanında yüksek rıza, yeterli ambar ve düşük iç baskı mahalle desteği
üretir; kırılgan şehirde ise halk barış baskısı yapar. Bu sonuç savunma
moraline girer. Saha ve kuşatma kayıpları da savunanın rızasını ve iç
baskısını kalıcı olarak etkiler.

Kral sefere katılırsa sahadaki ilk çatışmada moral desteği verir ve kendi
raporunu haberci beklemeden görür. Buna karşılık 24 oyun saatini aşan yokluk,
dönüşte başkentin rızasını aşındırır.

### `war_supports` — tarafsız ikmal konvoyları

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `war_id`, `supporter_id` | Konvoy, desteklediği sefer ve gönderen krallık kimliği. |
| `side`, `food` | Desteğin saldırana mı savunana mı gittiği ve taşınan yiyecek. |
| `status`, `sent_at`, `arrives_at`, `delivered_at` | Konvoyun yolda, ulaştı veya geç kaldı durumu ile zaman damgaları. |

Konvoy yolculuğu anlık değildir. Aktif savaşa zamanında ulaşırsa ordunun
ikmaline eklenir ve sınırlı moral desteği verir; sefer bittiyse yük yerel
ihtiyaç sahiplerine bırakılır ve destekçiye rapor düşer.

### `war_commands` — sahaya gönderilen Kral emirleri

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `war_id`, `issuer_id` | Emir, ilgili sefer ve emri veren Kral. |
| `kind` | `advance`, `hold` veya `withdraw`. |
| `status`, `sent_at`, `arrives_at`, `applied_at` | Emrin yolda, uygulandı veya geç kaldı durumu ile zaman damgaları. |

Kral başkentteyse emir haberci yolculuğu tamamlanınca uygulanır; Kral
cephedeyse aynı emir anında varmış kabul edilir. Ordu temasa geçmiş veya dönüşe
başlamışsa geç gelen emir uygulanmaz ve Defter'e yazılır.

### `war_armies` — seferdeki iki ordu

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `war_id`, `side` | Sefer ve `attacker` / `defender` birleşik kimliği. |
| `units` | Birlik türü ve adetleri. JSON metni. |
| `supply`, `initial_supply` | Kalan ve başlangıç erzağı. |
| `approach` | Temkinli, dengeli, yoğun veya sert karşılık yaklaşımı. |
| `withdraw_threshold` | Bu taraf için geri çekilme eşiği. |
| `updated_at` | Ordu kaydının son güncellenmesi. |

### `war_defenses` — çevrimdışı savunma doktrini

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `user_id`, `channel_id` | Kral ve dünya birleşik kimliği. |
| `doctrine` | `cautious`, `balanced`, `hard_response`. |
| `updated_at` | Doktrinin son ayarlanma zamanı. |

### `war_events` — savaş kronolojisi

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `war_id`, `sequence` | Sefer içindeki sıralı, benzersiz olay kimliği. |
| `kind`, `message` | Olay türü ve deftere yazılan açıklama. |
| `at`, `visible_at` | Olayın sahada gerçekleştiği ve haberciyle görünür olduğu zaman. `visible_at=0` eski olayların görünür kalmasını sağlar. |

### `war_reports` — krala iletilen savaş haberleri

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `war_id`, `user_id` | Haber, ait olduğu sefer ve alıcı kral. |
| `kind`, `summary` | Haber türü ve özet metni. |
| `created_at`, `available_at`, `read_at` | Haberin sahada oluştuğu, haberciyle Krala ulaştığı ve kral tarafından okunduğu zaman. |

Her savaş olayı iki taraf için ayrı haber satırı yaratabilir; her kral kendi
“okudum” işaretini taşır. Saha sonucu anında arayüze düşmez: yol süresinden
türetilen haberci gecikmesi tamamlanınca görünür olur.

## 7. Müzakere, anlaşma ve sistem sayaçları

### `rate_limits` — hız sınırı sayaçları

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `bucket` | Sınırlandırılan işlem/pencere kimliği. |
| `count` | Penceredeki istek sayısı. |
| `window_start` | Sayım penceresinin başlangıcı. |

### `negotiations` — diplomatik masa

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `channel_id` | Müzakere ve dünya kimliği. |
| `initiator_id`, `target_id` | Masayı açan ve karşı taraf. |
| `topic` | Haraç, saldırmazlık, ittifak, geçiş, ültimatom veya kiralık birlik. |
| `status` | `open`, `awaiting_king`, `agreed`, `declined`, `expired`. |
| `turns` | Müzakeredeki söz/karşı teklif sayısı. |
| `proposed`, `proposed_by` | Son sunulan şartın JSON içeriği ve tarafı. |
| `opened_at`, `expires_at`, `last_turn_at` | Açılış, son geçerlilik ve son konuşma zamanı. |

### `negotiation_messages` — müzakere yazışmaları

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `negotiation_id` | Mesaj ve bağlı olduğu masa. |
| `side` | `initiator` veya `target` tarafı. |
| `speaker` | Sözü Generalin mi Kralın mı söylediği. |
| `body` | Yazışma metni. |
| `at` | Söylenme zamanı. |

### `agreements` — imzalanmış anlaşmalar

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `channel_id`, `negotiation_id` | Anlaşma, dünya ve kaynak müzakere masası. |
| `topic` | Anlaşmanın diplomatik türü. |
| `payer_id`, `payee_id` | Haraçta ödeyen ve alan; diğer türlerde iki tarafı temsil eder. |
| `terms` | İmzalanan şartların JSON içeriği. |
| `started_at`, `ends_at`, `every_hours` | Yürürlük, bitiş ve haraç turu aralığı. |
| `paid_count`, `missed_count` | Başarılı ve kaçırılmış ödeme sayısı. |
| `status` | `active`, `completed`, `broken`. |

### `mercenary_contracts` — kiralık birlik sözleşmesi

| Kolon | Tuttuğu bilgi |
| --- | --- |
| `id`, `channel_id`, `agreement_id` | Sözleşme, dünya ve onu doğuran imzalı anlaşma. |
| `lessor_id`, `renter_id` | Vatandaşlarını kiraya veren ve birlikleri garnizonunda kullanan krallık. |
| `count`, `fee` | Başlangıç birlik sayısı ve imzada bir kez taşınan peşin altın bedeli. |
| `started_at`, `ends_at` | Hizmetin başlangıç ve planlı dönüş zamanı. |
| `status`, `returned_at` | Aktif, tamamlanmış veya iptal edilmiş sözleşme ile gerçek dönüş zamanı. |

Kiralık Birlik kiracının `units.mercenary` sayısında savaşır; kayıp kiralayanın
nüfusuna aittir. Süre dolduğunda aktif sefer yoksa sağ kalanlar kiralayanın
nüfusuna döner. Aynı kiracı için yalnız bir aktif sözleşme tutulur; böylece
toplu birlik sayısının kaynağı belirsizleşmez.

## Veri sahipliği: hangi bilgi nerede yaşar?

| Bilgi | Tek doğru kaynak |
| --- | --- |
| Kralın kişisel ekonomisi, binaları, asker adedi | `game_saves.game_state` |
| Generalin kişisel hafızası ve talepleri | `general_ledger`, `general_requests` |
| Halk/Garnizonun açık sesi | `populace_demands`, `council_briefings` |
| Birden fazla krallığı ilgilendiren sefer | `wars` ve alt tabloları |
| Diplomasi yazışması ve imzalı şart | `negotiations`, `negotiation_messages`, `agreements` |
| Kiralık birliklerin gerçek sahibi ve dönüşü | `mercenary_contracts` |
| Channel çapındaki operasyonlar | `intel_missions`, `agitations`, `migrations`, `shared_mines` |

## Bakım notu

Yeni bir tablo ya da kolon eklenirse önce `db/schema.ts`, sonra PostgreSQL
migration'ı güncellenir. Kişisel oyun kaydına yeni alan ekleniyorsa ayrıca
`server/save-validation.ts` içindeki katı şemanın ve server-derived alanların
aynı değişiklikte güncellenmesi gerekir.
