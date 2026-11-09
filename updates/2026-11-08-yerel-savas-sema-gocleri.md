# Yerel savaş şeması göçleri

Tarih: 2026-11-08

## Ne değişti

Eski yerel geliştirme veritabanında eksik kalan 0030–0035 arası ekleyici PostgreSQL göçleri uygulandı. Savaş destek türleri, savaş safhası alanları, ateşkes bağı, diplomatik ilişkiler, Casus Ağı ve ortak maden nüfuzu için gereken tablo ve sütunlar artık yerelde mevcut.

## Neden

Sefer Masası `war_supports.kind` sütunu bulunmadığı için sunucuda 500 hatası veriyordu. Aynı eski şema durumu müzakere, Diyar ve maden isteklerini de eksik sütunlar veya tablolar nedeniyle bozuyordu.

## Etkilenen dosyalar

- drizzle/pg/0030_war_support_kinds.sql
- drizzle/pg/0031_war_battle_phases.sql
- drizzle/pg/0032_war_truce_negotiations.sql
- drizzle/pg/0033_diplomatic_relations.sql
- drizzle/pg/0034_spy_networks.sql
- drizzle/pg/0035_shared_mine_influence.sql

## Test durumu

- PostgreSQL doğrulaması: `war_supports.kind`, `negotiations.war_id`, `shared_mines.influence_owner_id` ve `spy_networks` mevcut.
- Önceki tam test turu: `npm test` — 742 geçti, 0 başarısız.
