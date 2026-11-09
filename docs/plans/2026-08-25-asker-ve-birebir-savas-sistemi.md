# Demirkale — Asker Çeşitleri ve Birebir Savaş Sistemi Planı

Tarih: 2026-08-25
Durum: Uygulandı ve doğrulandı — Faz A–E ile Linux üretim kurulumu 2026-11-06 itibarıyla işlendi.

> Uygulama notu (2026-11-06): Birlik kataloğu, ayrı eğitim kuyruğu, sunucu sahipli sefer kayıtları, yürüyüş/dönüş, deterministik üç safhalı saha savaşı, savunma doktrini, kuşatma, huruç, geri çekilme, ikmal, raporlar, savaş puanından barış belgesi ve Sefer Masası uygulanmıştır. General yapılandırılmış sefer taslağı bırakabilir; taslak asker göndermez ve savaşı yalnız Kral mühürler. İlk sürüm bilinçli olarak **krallık başına tek aktif sefer** sınırını taşır; çoklu cephe gelecekteki kapsamdır. Faz E için bin senaryolu deterministik simülasyon, kayıtlı doktrin, responsive Sefer Masası ve kalıcı savaş olayları üzerinden analiz altyapısı doğrulanmıştır.

## 1. Karar özeti

Önerilen ilk sürüm dört savaş birliği ve bir kuşatma desteği içerir: Mızrakçı, Kılıçlı, Okçu, Süvari ve Kuşatma Ekibi. Birliklerin tamamı tek bir `unitCatalog` kaynağından maliyet, eğitim süresi, insan gücü, bakım, saldırı, savunma, hız ve kuşatma değerlerini okur.

Birebir savaş canlı mikro-yönetim değil, kalıcı çok oyunculu yapıya uygun **eşzamansız sefer** olarak tasarlanır. General bir plan önerir; oyuncu hedefi, savaş amacını, birlikleri ve yaklaşımı onaylar veya değiştirir. Sefer mutlak zaman damgalarıyla ilerler, çatışma sunucuda deterministik çözülür ve iki tarafa aynı savaş raporu gösterilir.

İlk sürümde bir krallık kalıcı olarak silinmez veya ele geçirilmez. Savaş; yağma, diplomatik taviz ve kuşatma baskısı üretir. Toprak fethetme ancak haritada gerçek bölge sahipliği sistemi kurulduktan sonra eklenmelidir.

## 2. Mevcut sistemin başlangıç noktası

- Tek birlik türü `spearman` / Mızrakçı.
- 1 Mızrakçı, sivil nüfustan 1 kişi eksiltir.
- Birim maliyeti: 8 altın, 10 yiyecek, 1 demir.
- Eğitim süresi: kişi başına 1.200 oyun saniyesi; channel hızına bölünür.
- Bütün askerler aynı saatlik maaşı kullanır: kişi başına 0,35 altın.
- Askerler sivil nüfustan çıktığı için mevcut yiyecek talebinde ayrıca asker rasyonu ödemez.
- Akın savunması birlik türünü ayırmaz; toplam asker sayısını 1,4 savunma katsayısıyla çarpar.
- Tek `queue`, inşaat ve asker eğitimini aynı anda engeller.
- Oyuncular arası doğrudan savaş durumu veya sunucuya ait savaş kaydı yoktur.

Bu nedenle yeni askerler yalnızca `units` alanına yeni anahtarlar eklenerek tamamlanamaz. Birlik kataloğu, insan gücü hesabı, farklı bakım giderleri, ayrı eğitim kuyruğu, sefer durumu ve savaş çözümleyicisi birlikte ele alınmalıdır.

## 3. Tasarım hedefleri

1. **Her birliğin anlaşılır bir işi olmalı.** Daha pahalı olan her koşulda daha iyi olmamalı.
2. **Ordu ekonomiden kopmamalı.** Asker sivil nüfusu, yiyeceği, altını ve üretim kapasitesini azaltmalı.
3. **Hazırlık sonucu belirlemeli.** İstihbarat, ikmal, arazi, moral ve geri çekilme eşiği salt asker sayısı kadar önemli olmalı.
4. **Çevrimdışı oyuncu savunmasız bırakılmamalı.** Önceden belirlenen savunma doktrini ve Generalin varsayılan önerisi kullanılmalı.
5. **Sonuç yeniden yüklemeyle değişmemeli.** Motor saf, sunucu otoriter ve savaş çözümü deterministik olmalı.
6. **Yenilgi oyun sonu olmamalı.** Kayıp ağır olabilir; ancak tek savaşla hesabın silinmesi ve geri dönülemez kartopu engellenmeli.

## 4. Önerilen birlik kataloğu

Rakamlar ilk dengeleme hipotezidir. Kodlanmadan önce simülasyon testleriyle doğrulanmalıdır.

| Birlik | Kilit | İnsan gücü | Kuruluş maliyeti | Eğitim / birlik | Saatlik bakım | Saldırı | Savunma | Hız | Kuşatma | Stratejik rol |
|---|---:|---:|---|---:|---|---:|---:|---:|---:|---|
| Mızrakçı | Kışla Sv.1 | 1 | 8 altın, 10 yiyecek, 1 demir | 20 dk | 0,35 altın, 0,035 yiyecek | 9 | 16 | 6 | 2 | Hat tutar; Süvariye karşı +%35 |
| Kılıçlı | Kışla Sv.2 | 1 | 14 altın, 14 yiyecek, 3 demir | 30 dk | 0,45 altın, 0,040 yiyecek | 15 | 12 | 7 | 4 | Dengeli hücum; Mızrakçıya karşı +%20 |
| Okçu | Kışla Sv.2 | 1 | 12 altın, 12 yiyecek, 8 odun, 1 demir | 35 dk | 0,40 altın, 0,040 yiyecek | 17 | 7 | 7 | 3 | İlk safhada atış; Kılıçlıya karşı +%20 |
| Süvari | Kışla Sv.3 | 2 | 30 altın, 24 yiyecek, 5 demir | 55 dk | 0,80 altın, 0,070 yiyecek | 22 | 10 | 14 | 1 | Kanat ve takip; Okçuya +%35, Mızrakçıya -%35 |
| Kuşatma Ekibi | Kışla Sv.3 | 4 | 45 altın, 30 yiyecek, 40 odun, 8 demir | 80 dk | 0,70 altın, 0,120 yiyecek | 4 | 5 | 3 | 30 | Sur baskısı; tek başına sefere çıkamaz |

### Katalog kuralları

- Mızrakçının bugünkü maliyeti ve eğitim süresi korunur; mevcut kayıtlar anlam değiştirmez.
- `insan gücü`, birliğin sivil nüfustan kaç kişi çektiğini ve sefer rasyonunu belirler.
- Birlik sayısı ile insan gücü aynı şey değildir. 10 Süvari, orduda 10 birliktir fakat 20 kişilik nüfus ve bakım yükü taşır.
- Eğitim süresi doğrusal ve oyun zamanıdır: gerçek süre = oyun süresi / channel hızı.
- Eğitim başlangıcında insan gücü ve kuruluş maliyeti ayrılır. Kuyruk tamamlanınca birlik orduya eklenir.
- En az 20 sivil nüfus bırakma kuralı korunur. Toplu eğitim sınırı birlik sayısıyla değil toplam insan gücüyle uygulanır.
- Kışla, inşaattan ayrı bir `trainingQueue` kullanır. Kışla seviyesi ilk sürümde aynı anda tek eğitim emri açar; daha sonra seviye başına yuva eklenebilir.

## 5. Ekonomi ve ihtiyaç sistemi

### Barış zamanı

- Her birlik kendi `goldUpkeep` ve `foodUpkeep` değerini öder.
- Maaş eksikliği mevcut `soldierUnrest` sistemini büyütmeye devam eder.
- Yiyecek eksikliği ayrıca `armySupply` düşürür; düşük ikmal eğitim, nöbet ve savaştaki etkinliği azaltır.
- Sivil nüfus askere alındığı anda üretici havuzdan çıkar. Mevcut ekonomik bedel korunur.

### Sefer zamanı

- Seferde yiyecek tüketimi katalog değerinin 2 katıdır.
- Ordu çıkarken tahmini gidiş + çatışma + dönüş süresinin %120'si kadar erzak ayırır.
- Erzak oranı %50'nin altına düşerse savaş gücü kademeli olarak en fazla %40 azalır.
- Erzak biterse ordu saldırıya devam etmez; varsayılan emir geri çekilmedir.
- Yağma erzak kazandırabilir fakat sefer maliyetini tamamen sıfırlayacak kadar büyük olamaz.

## 6. Haritada ilerleme süresi

Harita mevcut dünya koordinatlarını kullanır. Bir ordunun hızı, içindeki en yavaş birlik tarafından belirlenir.

```text
mesafe = hypot(hedef.x - kaynak.x, hedef.z - kaynak.z)
oyunSaati = clamp(1, 24, mesafe / enYavaşHız × 1,5 / rotaÇarpanı)
gerçekSaat = oyunSaati / channelHızı
```

`rotaÇarpanı` mevcut arazi seyahat değerinden gelir: Ova 1,00; Orman 0,85; Nehir Kıyısı 0,75; Dağ 0,65. Nehir geçişi veya kuşatma ekipmanı gibi rota olayları ayrıca süre ekleyebilir.

### 30 birimlik örnek rota

| Ordu yapısı | En yavaş hız | Ova | Orman | Nehir Kıyısı | Dağ |
|---|---:|---:|---:|---:|---:|
| Yalnız Süvari | 14 | 3,2 sa | 3,8 sa | 4,3 sa | 4,9 sa |
| Piyade ordusu | 6 | 7,5 sa | 8,8 sa | 10,0 sa | 11,5 sa |
| Kuşatma konvoyu | 3 | 15,0 sa | 17,6 sa | 20,0 sa | 23,1 sa |

Bu değerler oyun saatidir. ×24 channel'da 7,5 oyun saati yaklaşık 18 dakika 45 saniye gerçek zamandır.

## 7. Savaş başlatma ve yetki

### Ön koşullar

- Hedef aynı channel'da ve keşfedilmiş olmalı.
- Saldıranın kuruluş koruması bitmiş olmalı.
- Hedefin aktif koruması varsa savaş ilan edilemez.
- Saldırmazlık anlaşması yürürlükteyse saldırı kilitlidir. Anlaşmayı bozmak ayrı bir Kral kararıdır ve itibar cezası üretir.
- Aynı hedefe tekrar saldırmak için bekleme süresi bulunur.
- Ordu en az bir savaş birliği ve yeterli dönüş erzağı içermelidir.

### General ve oyuncu arasındaki görev ayrımı

- General otomatik olarak hedef, bileşim, yaklaşım, geri çekilme eşiği ve ikmal önerir.
- Oyuncu öneriyi kabul eder veya değiştirir.
- Savaş ilanı, anlaşma bozma, kalıcı kayıp riski taşıyan kuşatma ve barış şartı oyuncunun mührünü gerektirir.
- Oyuncu çevrimdışıyken General yeni saldırı başlatamaz; yalnız önceden belirlenen savunma doktrinini uygular.

## 8. Birebir savaşın yaşam döngüsü

### 1. Amaç ve sefer emri

Oyuncu üç amaçtan birini seçer:

- **Yağma:** kısa sefer, sınırlı kaynak kazanımı, kuşatma yok.
- **Tavize zorlama:** savaş puanı üretir; haraç veya anlaşma şartını güçlendirir.
- **Kale baskısı:** saha zaferinden sonra kuşatma açar; en pahalı ve riskli yol.

Emir; hedef, birlikler, yaklaşım, ikmal miktarı ve geri çekilme eşiğini içerir.

### 2. Toplanma

- Ayrılan birlikler garnizondan düşer ve yerel nöbete katkı vermez.
- 30 oyun dakikalık asgari hazırlık bulunur.
- Kuşatma Ekibi veya %50'den fazla Süvari taşıyan ordu ek hazırlık süresi alır.
- Bu aşamada emir iptal edilebilir; tüketilmeyen ikmal geri döner.

### 3. Yürüyüş ve haber alma

- `departsAt` ve `arrivesAt` mutlak zaman damgalarıdır.
- Savunan taraf saldırıyı istihbarat seviyesine göre erken veya geç görür.
- Savunan oyuncu hazırsa nöbet, savunma yaklaşımı ve takviye bileşimini değiştirir.
- Çevrimdışıysa kayıtlı savunma doktrini devreye girer: Temkinli, Dengeli veya Sert Karşılık.

### 4. Temas ve saha savaşı

Çatışma tek anda rastgele bir sayı üretmez. Üç deterministik safhada çözülür:

1. **Atış:** Okçular etkili olur; arazi görüşü ve savunma hazırlığı uygulanır.
2. **Hat çatışması:** Mızrakçı, Kılıçlı ve Süvari karşı birlik ilişkileriyle çarpışır.
3. **Moral ve takip:** Geri çekilme eşiği kontrol edilir; Süvari kaçan orduyu takip edebilir.

Her safha sonunda kayıp, moral ve ikmal güncellenir. Önceden belirlenen geri çekilme eşiğine ulaşan ordu sonraki safhaya girmez.

### 5. Saha sonucu

- **Püskürtüldü:** saldıran geri döner; savunana savaş puanı ve itibar katkısı.
- **Taktik zafer:** saldıran savaş amacını uygular veya geri döner.
- **Yarma:** kale baskısı amacı varsa kuşatma açılır.
- **Karşı saldırı fırsatı:** savunan, geri çekilen orduya sınırlı takip emri verebilir.

### 6. Kuşatma

- Saatlik, kapalı çözüme uygun kuşatma ilerlemesi hesaplanır.
- Kuşatma gücü, Kuşatma Ekibi ve kalan piyadeden; savunma, Sur, Kale, garnizon ve araziden gelir.
- Her oyun saatinde iki taraf yiyecek ve maaş tüketir.
- Savunan huruç yapabilir; saldıran geri çekilebilir.
- Kale düşmesi krallığı silmez. Üretim baskısı, sınırlı yağma ve güçlü barış şartı açar.

### 7. Barış ve dönüş

- Savaş puanı; saha zaferi, kuşatma ilerlemesi, kayıplar ve savaş amacından türetilir.
- Sonuç Müzakere ekranındaki anlaşma belgesine taşınır.
- Dönüş de harita süresi tüketir. Hayatta kalan birlikler dönüş tamamlanana kadar garnizona eklenmez.
- Savaş raporu iki tarafa aynı olay kimliğiyle kaydedilir.

## 9. Savaş gücü ve karşı birlikler

Temel formül iki taraf için ayrı hesaplanır:

```text
güç = Σ(adet × safhaDeğeri × karşıBirlik × maruziyet)
      × moral × ikmal × yaklaşım × arazi × tahkimat
```

- `safhaDeğeri`, atışta Okçu saldırısını; hat çatışmasında saldırı/savunmayı; takipte Süvari hızını öne çıkarır.
- Karşı birlik çarpanları ilk sürümde 0,65–1,35 aralığında tutulur. Kompozisyon önemli olur fakat tek karşı birlik bütün savaşı otomatik kazanmaz.
- Savunma arazisi mevcut `terrainCatalog.defense` değerini kullanır.
- Sur yalnız kale savunmasında etkilidir; açık arazi savaşına katılmaz.
- Moral, sadakat ve `soldierUnrest`; ikmal, ayrılan erzağın kalan oranından türetilir.
- Yaklaşım: Temkinli daha az kayıp ve erken geri çekilme; Dengeli nötr; Yoğun daha yüksek güç ve daha ağır kayıp üretir.

### Kayıp modeli

```text
kayıpPayı = clamp(%3, %18, %8 × rakipGüç / kendiGüç × yaklaşımÇarpanı)
```

Kayıplar safhadaki maruziyete göre birliklere dağıtılır. Tohumlu karma yalnız eşitlik ve kesir yuvarlamasını çözer; oyuncu sonucu sayfayı yenileyerek değiştiremez. Tek safhada ordunun tamamı yok olmaz.

## 10. Kartopu ve kötüye kullanım frenleri

- İlk sürümde kalıcı krallık ele geçirme yok.
- Yeni veya korumalı krallığa saldırı yok.
- Aynı hedef için savaş sonrası dokunulmazlık.
- Yağma hedef stokunun küçük, tavanlı bir yüzdesidir; fakir hedef negatif kaynağa düşmez.
- Saldıranın dönüş erzağı yoksa sefere çıkamaz.
- Saldırmazlık anlaşmasını bozmak itibar ve diplomasi cezası verir.
- Savaş kayıtları istemci kaydında değil sunucu veritabanında tutulur.
- Çözüm tek olay kimliği ve koşullu güncelleme ile bir kez çalışır.
- Kayıp ve ödüller istemciden kabul edilmez.
- Aynı hesabın iki krallığını danışıklı biçimde savaştırmasına karşı ödül ve hedef bekleme sınırları uygulanır.

## 11. Teknik mimari

### Tek doğru kaynaklar

- `engine/units.ts`: birlik kataloğu, insan gücü, bakım, eğitim süresi ve karşı birlik katsayıları.
- `engine/war.ts`: saf savaş emri doğrulama, güç, kayıp ve savaş raporu hesapları.
- `engine/march.ts`: mesafe, arazi ve ordu bileşimine göre yol süresi.
- `engine/siege.ts`: kuşatma ilerlemesi ve ikmal tüketimi.

### Sunucu sahipliği

Çapraz oyuncu durumu save dosyasına yazılmamalıdır. Önerilen tablolar:

- `wars`: taraflar, amaç, durum, zaman damgaları, savaş puanı, sürüm.
- `war_armies`: taraf, birlik bileşimi, ikmal, yaklaşım, geri çekilme eşiği.
- `war_events`: yürüyüş, temas, safha, kayıp, kuşatma ve barış olayları.
- `war_reports`: iki oyuncuya gösterilecek değişmez sonuç özeti.

### API ve General araçları

- `GET /api/war`: aktif savaşlar, yaklaşan tehditler ve raporlar.
- `POST /api/war`: planla, ilan et, savunma emri ver, geri çekil, huruç yap, barış sun.
- General araçları: `propose_campaign`, `set_defense_doctrine`, `respond_to_war`.
- `declare_war` doğrudan model aracı olmamalı; General önerir, oyuncu mühürler.

### Save şeması etkisi

- `units` kayıt biçimi korunabilir; yeni anahtarlar katalogdan doğrulanır.
- `trainingQueue` eklenecekse `engine/types.ts`, `.strict()` save şeması, `SERVER_DERIVED` değerlendirmesi, kuruluş durumu ve migration aynı değişiklikte ele alınmalıdır.
- Birlik insan gücü ve bakım hesapları `armySize()` toplamından türetilmemeli; katalog kullanan `armyManpower()` ve `armyUpkeep()` tek kaynak olmalıdır.

## 12. Arayüz akışı

### Ordu sayfası

- Hazırlık özeti: garnizon, seferdeki ordu, toplam insan gücü, saatlik bakım ve ikmal günü.
- Birlik satırları: adet, saldırı, savunma, hız, rol ve eğitim eylemi.
- Eğitim belgesi: tür → adet → toplam nüfus/maliyet/süre → General görüşü → oyuncu onayı.

### Diyar haritası

- Hedef panelinde mesafe, tahmini yol, rapor yaşı, bilinen birlikler ve arazi.
- “Sefer planla” eylemi Savaş sayfasındaki planlayıcıyı hedef seçilmiş olarak açar.

### Savaş planlayıcı

1. Amaç seç.
2. Hedef ve rota seç.
3. Birlik bileşimini belirle.
4. İkmal, yaklaşım ve geri çekilme eşiğini belirle.
5. Generalin önerisini gör.
6. Savaş ilanını mühürle.

### Aktif savaş ekranı

- Büyük aşama göstergesi: Toplanıyor → Yürüyor → Temas → Çatışma → Kuşatma/Dönüş.
- Kalan süre ve bir sonraki karar açıkça görünür.
- Savaş raporu safha safha kayıp nedenini açıklar; yalnız “güç 135” gibi opak bir sayı göstermez.

## 13. Geliştirme fazları

### Faz A — Birlik çekirdeği, 3–5 geliştirici günü

- `unitCatalog`, yeni birlik tipleri ve katalog testleri.
- İnsan gücü ve tür bazlı bakım.
- Ayrı eğitim kuyruğu ve General araç şeması.
- Ordu ekranında birlik kartları ve eğitim belgesi.

Çıkış ölçütü: bütün birlikler eğitilebilir; nüfus, maliyet, süre ve bakım aynı katalogdan türetilir.

### Faz B — Sefer ve yol, 4–6 geliştirici günü

- Sunucuya ait savaş tabloları ve idempotent API.
- Harita mesafesi, rota süresi, toplanma, gidiş ve dönüş.
- Koruma/anlaşma/tekrar hedefleme kontrolleri.
- Çevrimdışı savunma doktrini.

Çıkış ölçütü: iki gerçek krallık ordusunu hareket ettirebilir; henüz çatışma yerine güvenli test raporu oluşur.

### Faz C — Saha savaşı, 5–7 geliştirici günü

- Üç safhalı deterministik çözüm.
- Karşı birlik, moral, ikmal, arazi, yaklaşım ve geri çekilme.
- Kayıp dağıtımı ve savaş raporu.
- Savaş planlayıcı ve aktif savaş ekranı.

Çıkış ölçütü: aynı girdiler her adım bölünmesinde ve yeniden çalıştırmada aynı sonucu üretir.

### Faz D — Kuşatma ve barış, 4–6 geliştirici günü

- Kuşatma ilerlemesi, huruç, geri çekilme ve ikmal.
- Savaş puanı, yağma tavanları ve Müzakere entegrasyonu.
- Savaş sonrası dokunulmazlık ve itibar etkisi.

Çıkış ölçütü: savaş kalıcı hesap silmeden diplomatik ve ekonomik sonuç üretir.

### Faz E — Denge ve güvenlik, 3–5 geliştirici günü

- Binlerce otomatik savaş senaryosu.
- Mono-ordu, aç bırakma, çoklu hesap ve çevrimdışı oyuncu testleri.
- Mobil/masaüstü UI ve erişilebilirlik.
- Telemetri: birlik seçimi, seferden vazgeçme, kayıp oranı, savaş süresi.

Tahmini toplam: **19–29 geliştirici günü**. Toprak fethetme bu tahmine dahil değildir.

## 14. Test stratejisi

- Her birlik için maliyet, süre, insan gücü, bakım ve kilit testleri.
- Eski `spearman` kayıtlarının değişmeden okunması.
- Channel hızında eğitim ve yürüyüş sürelerinin doğru ölçeklenmesi.
- Parçalı tick ile tek büyük tick arasında birebir savaş sonucu eşitliği.
- Aynı savaşın iki kez çözülememesi.
- Koruma ve saldırmazlık anlaşmasının atlanamaması.
- Kayıpların mevcut birlikten fazla olmaması; kaynakların negatif olmaması.
- Her birlik kompozisyonunun en az bir güçlü ve bir zayıf eşleşmesi olması.
- Saf Mızrakçı, saf Okçu, saf Süvari gibi mono-ordu stratejilerinin tek baskın çözüm olmaması.
- Çevrimdışı savunmanın kayıtlı doktrini kullanması.
- İstemcinin sahte zafer, kayıp veya ödül yazamaması.

## 15. Geliştirme öncesi onaylanması gereken kararlar

1. İlk sürümde dört savaş birliği + bir kuşatma desteği uygun mu?
2. Süvari için ilk sürümde Kışla Sv.3 yeterli mi, yoksa yeni Ahır binası şart mı?
3. Birebir savaş eşzamansız ve önceden emir verilen yapıda mı olmalı?
4. İlk sürümde kalıcı fetih olmaması kabul ediliyor mu?
5. Yağma, Tavize Zorlama ve Kale Baskısı üç savaş amacı olarak yeterli mi?
6. Çevrimdışı savunmada Generalin yalnız önceden seçilmiş doktrini uygulaması uygun mu?

## Önerilen geliştirme sırası

Önce yalnız Faz A uygulanmalı ve yeni birlik ekonomisi gerçek oyun verisinde gözlenmelidir. Eğitim, bakım ve nüfus yükü dengelenmeden oyuncular arası savaş açılırsa sonraki bütün savaş sonuçları hatalı bir ekonomik tabana oturur. Faz B ve Faz C ancak birlik kataloğu simülasyonları kabul edildikten sonra başlamalıdır.
