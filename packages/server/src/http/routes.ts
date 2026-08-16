/**
 * REST route'ları.
 *
 * Aksiyonlar tek bir generic uçtan (`/actions/:name`) geçiyor: Kral'ın
 * arayüzden bastığı düğme ile General'ın tool çağrısı **aynı** yürütücüye
 * (`executeAction`) düşsün diye. İki ayrı yol olsaydı doğrulama kuralları
 * ikiye ayrılırdı — §15.5'in tam olarak engellemek istediği durum.
 */

import type { FastifyInstance } from 'fastify';
import {
  BALANCE,
  LLM_PROVIDERS,
  tileDistance,
  type BattleReportDto,
  type DiplomacyThreadDto,
  type ProtectionRelationshipDto,
  type RealmViewDto,
  type RegionBulletinDto,
  type RelationEdgeDto,
  type TradeAgreementDto,
  type LlmProvider,
} from '@krallik/shared';
import { config } from '../config.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import type {
  BattleReportRow,
  CaravanRow,
  ChannelRow,
  DiplomacyThreadRow,
  DiplomacyTurnRow,
  KingdomRelationRow,
  KingdomRow,
  MapTileRow,
  MarketOfferRow,
  NotificationRow,
  PendingDecisionRow,
  ProtectionRelationshipRow,
  TradeAgreementRow,
} from '../db/rows.js';
import { executeAction, newNonce } from '../game/actions.js';
import { loadKingdomSnapshot } from '../game/state.js';
import { createChannel, joinChannel, restartAsRefugee } from '../game/world.js';
import { loadOwnedKingdom, requireAdmin, requireAuth } from './auth.js';
import {
  toChannelDto,
  toKingdomStateDto,
  toMarketOfferDtos,
  toNotificationDto,
  toPendingDecisionDto,
} from './dto.js';

export function registerRoutes(app: FastifyInstance): void {
  // ------------------------------------------------------------- channels
  app.get('/api/channels', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.authUser!.id;

    const channels = await query<ChannelRow>(
      `SELECT * FROM channels WHERE status <> 'finished' ORDER BY created_at DESC LIMIT 100`,
    );
    const counts = await query<{ channel_id: string; count: number }>(
      `SELECT channel_id, COUNT(*)::int AS count FROM kingdoms WHERE status = 'active' GROUP BY channel_id`,
    );
    const countByChannel = new Map(counts.map((c) => [c.channel_id, c.count]));

    const mine = await query<{ channel_id: string; id: string }>(
      `SELECT channel_id, id FROM kingdoms WHERE user_id = $1 AND status <> 'refugee'`,
      [userId],
    );
    const joinedChannels = new Set(mine.map((k) => k.channel_id));

    const dtos = channels.map((c) =>
      toChannelDto(c, {
        kingdomCount: countByChannel.get(c.id) ?? 0,
        joined: joinedChannels.has(c.id),
      }),
    );

    return reply.send({
      joined: dtos.filter((c) => c.joined),
      open: dtos.filter((c) => !c.joined),
      // Frontend'in doğrudan krallığa yönlenebilmesi için eşleme.
      kingdomsByChannel: Object.fromEntries(mine.map((k) => [k.channel_id, k.id])),
    });
  });

  app.post<{ Params: { id: string }; Body: { kingdomName?: string } }>(
    '/api/channels/:id/join',
    { preHandler: requireAuth },
    async (request, reply) => {
      const name = (request.body?.kingdomName ?? '').trim();
      if (name.length < 2) {
        return reply.code(400).send({ error: 'Krallık adı en az 2 karakter olmalı.' });
      }
      try {
        const result = await joinChannel({
          userId: request.authUser!.id,
          channelId: request.params.id,
          kingdomName: name,
        });
        return reply.send({ kingdomId: result.kingdom.id });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  // Admin: channel oluşturma (§16.1).
  app.post<{
    Body: {
      name?: string;
      channelType?: 'season' | 'short' | 'recurring';
      durationDays?: number;
      llmRestriction?: { allowedProviders?: LlmProvider[]; allowedModels?: string[]; minTier?: 'small' | 'standard' | 'frontier' } | null;
    };
  }>('/api/admin/channels', { preHandler: requireAdmin }, async (request, reply) => {
    const name = (request.body?.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'Channel adı gerekli.' });

    const channel = await createChannel({
      name,
      channelType: request.body?.channelType ?? 'season',
      durationDays: request.body?.durationDays ?? BALANCE.channel.defaultSeasonDays,
      llmRestriction: request.body?.llmRestriction ?? null,
      createdBy: request.authUser!.id,
    });
    return reply.send({ channelId: channel.id });
  });

  // -------------------------------------------------------------- kingdom
  app.get<{ Params: { id: string } }>(
    '/api/kingdoms/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;

      // Krallık görüntülemek "aktif" sayılır (§14.2): son X dakika içinde
      // arayüzü açan oyuncu pasif moda düşmez.
      await query('UPDATE kingdoms SET last_active_at = now() WHERE id = $1', [owned.id]);

      const snapshot = await loadKingdomSnapshot(owned.id);
      if (!snapshot) return reply.code(404).send({ error: 'Krallık yüklenemedi.' });

      return reply.send(await toKingdomStateDto(snapshot));
    },
  );

  /**
   * Diyar görünümü — 3B sahnenin zoom-out katmanı bunu tüketiyor.
   * Üçüncü taraf ilişkiler de döner: sana dokunmayan savaşlar ve ticaret
   * hatları da görünür (referans sahnenin açık tasarım tercihi).
   */
  app.get<{ Params: { id: string } }>(
    '/api/kingdoms/:id/realm',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;

      const self = await queryOne<{ x: number; y: number }>(
        'SELECT x, y FROM map_tiles WHERE id = $1',
        [owned.capital_tile_id],
      );
      const origin = self ?? { x: 0, y: 0 };

      const kingdoms = await query<
        KingdomRow & { cap_x: number | null; cap_y: number | null }
      >(
        `SELECT k.*, t.x AS cap_x, t.y AS cap_y
           FROM kingdoms k
           LEFT JOIN map_tiles t ON t.id = k.capital_tile_id
          WHERE k.channel_id = $1 AND k.status = 'active'`,
        [owned.channel_id],
      );

      const relations = await query<KingdomRelationRow>(
        'SELECT * FROM kingdom_relations WHERE channel_id = $1',
        [owned.channel_id],
      );
      const agreements = await query<{ kingdom_a_id: string; kingdom_b_id: string }>(
        `SELECT kingdom_a_id, kingdom_b_id FROM trade_agreements
          WHERE channel_id = $1 AND status = 'active'`,
        [owned.channel_id],
      );
      const protections = await query<{ protector_kingdom_id: string; vassal_kingdom_id: string }>(
        `SELECT protector_kingdom_id, vassal_kingdom_id FROM protection_relationships
          WHERE channel_id = $1 AND status = 'active'`,
        [owned.channel_id],
      );

      const edges: RelationEdgeDto[] = [
        ...relations
          .filter((r) => r.state === 'war' || r.state === 'ally')
          .map((r) => ({
            fromKingdomId: r.kingdom_a_id,
            toKingdomId: r.kingdom_b_id,
            kind: (r.state === 'war' ? 'hostility' : 'alliance') as RelationEdgeDto['kind'],
          })),
        ...agreements.map((a) => ({
          fromKingdomId: a.kingdom_a_id,
          toKingdomId: a.kingdom_b_id,
          kind: 'trade' as const,
        })),
        ...protections.map((p) => ({
          fromKingdomId: p.protector_kingdom_id,
          toKingdomId: p.vassal_kingdom_id,
          kind: 'protection' as const,
        })),
      ];

      const relationState = new Map<string, KingdomRelationRow['state']>();
      for (const r of relations) {
        const other = r.kingdom_a_id === owned.id ? r.kingdom_b_id : r.kingdom_a_id;
        if (r.kingdom_a_id === owned.id || r.kingdom_b_id === owned.id) {
          relationState.set(other, r.state);
        }
      }

      const now = config.now();
      const neighbors = kingdoms
        .filter((k) => k.id !== owned.id && k.cap_x !== null && k.cap_y !== null)
        .map((k) => ({
          id: k.id,
          name: k.name,
          x: k.cap_x!,
          y: k.cap_y!,
          population: Math.round(k.population),
          reputation: Math.round(k.reputation),
          relation: relationState.get(k.id) ?? ('neutral' as const),
          distanceTiles: tileDistance(origin, { x: k.cap_x!, y: k.cap_y! }),
          allianceId: k.alliance_id,
          allianceName: null,
          isProtected:
            k.protection_ends_at !== null && k.protection_ends_at.getTime() > now.getTime(),
        }))
        // Uzak bölgeler görünümü kirletmesin; 3B sahne zaten yakın çevreyi çiziyor.
        .sort((a, b) => a.distanceTiles - b.distanceTiles)
        .slice(0, 40);

      const tiles = await query<MapTileRow & { owner_name: string | null }>(
        `SELECT t.*, k.name AS owner_name
           FROM map_tiles t
           LEFT JOIN kingdoms k ON k.id = t.owner_kingdom_id
          WHERE t.channel_id = $1
            AND GREATEST(ABS(t.x - $2), ABS(t.y - $3)) <= $4
          ORDER BY t.x, t.y`,
        [owned.channel_id, origin.x, origin.y, BALANCE.diplomacy.regionRadiusTiles],
      );

      const scoreboard = [...kingdoms]
        .sort((a, b) => b.population - a.population)
        .slice(0, 10)
        .map((k, index) => ({
          kingdomId: k.id,
          name: k.name,
          population: Math.round(k.population),
          rank: index + 1,
        }));

      // "Çekişmeli bölge": iki krallığın da yakın olduğu, sahipsiz tile'lar.
      const contested = tiles
        .filter((t) => t.owner_kingdom_id === null)
        .filter((t) => {
          const near = neighbors.filter(
            (n) => tileDistance({ x: t.x, y: t.y }, { x: n.x, y: n.y }) <= 4,
          );
          return near.length >= 2;
        })
        .slice(0, 6)
        .map((t) => ({ x: t.x, y: t.y, label: 'Çekişmeli Bölge' }));

      const view: RealmViewDto = {
        self: { id: owned.id, name: owned.name, x: origin.x, y: origin.y },
        neighbors,
        edges,
        tiles: tiles.map((t) => ({
          id: t.id,
          x: t.x,
          y: t.y,
          terrain: t.terrain_type,
          ownerKingdomId: t.owner_kingdom_id,
          ownerKingdomName: t.owner_name,
          isCapital: t.is_capital,
          mineReserveRatio:
            t.mine_reserve_capacity && t.mine_reserve_capacity > 0
              ? (t.mine_reserve_remaining ?? 0) / t.mine_reserve_capacity
              : null,
        })),
        contestedTiles: contested,
        scoreboard,
      };

      return reply.send(view);
    },
  );

  // ----------------------------------------------------------------- chat
  app.get<{ Params: { id: string } }>(
    '/api/kingdoms/:id/chat',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;
      // Geçmiş salt mesaj listesidir; bekleyen kararlar ve General'ın sessizlik
      // durumu kendi uçlarından/krallık durumundan okunur.
      const response = await buildChatResponse(owned);
      return reply.send(response.messages);
    },
  );

  app.post<{ Params: { id: string }; Body: { message?: string } }>(
    '/api/kingdoms/:id/chat',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;

      const message = (request.body?.message ?? '').trim();
      if (!message) return reply.code(400).send({ error: 'Mesaj boş olamaz.' });

      await query('UPDATE kingdoms SET last_active_at = now() WHERE id = $1', [owned.id]);

      const general = await loadGeneral();
      if (!general) {
        return reply.code(503).send({ error: 'General katmanı şu anda kullanılamıyor.' });
      }

      // Sağlayıcı hatası bir HTTP 500 değil, oyun içi bir durum (§14.6):
      // General sessize düşer, Kral bilgilendirilir, krallık yaşamaya devam eder.
      await general.runGeneralTurn({
        kingdomId: owned.id,
        mode: 'active',
        kingMessage: message,
      });

      const fresh = await queryOne<KingdomRow>('SELECT * FROM kingdoms WHERE id = $1', [owned.id]);
      return reply.send(await buildChatResponse(fresh ?? owned));
    },
  );

  // ------------------------------------------------------------ decisions
  app.get<{ Params: { id: string } }>(
    '/api/kingdoms/:id/decisions',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;
      const rows = await query<PendingDecisionRow>(
        `SELECT * FROM pending_decisions WHERE kingdom_id = $1 AND status = 'awaiting'
          ORDER BY created_at`,
        [owned.id],
      );
      return reply.send(rows.map(toPendingDecisionDto));
    },
  );

  /**
   * Kral'ın büyük karar yanıtı (§14.5).
   *
   * Onaylanırsa park edilmiş aksiyon `preApproved` ile yeniden yürütülür —
   * kademeli karar kontrolü atlanır ama kaynak/kota/önkoşul doğrulaması
   * yeniden yapılır. "Onaylandı" hiçbir zaman "doğrulamayı geç" demek değil.
   */
  app.post<{ Params: { id: string; did: string }; Body: { response?: 'approve' | 'reject' } }>(
    '/api/kingdoms/:id/decisions/:did',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;

      const response = request.body?.response;
      if (response !== 'approve' && response !== 'reject') {
        return reply.code(400).send({ error: "response 'approve' ya da 'reject' olmalı." });
      }

      const result = await executeAction(
        'respond_to_decision',
        { decision_id: request.params.did, response },
        { kingdomId: owned.id, source: 'active', nonce: newNonce() },
      );

      if (!result.ok) return reply.code(400).send({ error: result.message, code: result.errorCode });

      if (response === 'approve') {
        const pending = result.data?.pendingAction as
          | { name: string; arguments: Record<string, unknown> }
          | undefined;
        if (pending) {
          const applied = await executeAction(pending.name, pending.arguments, {
            kingdomId: owned.id,
            source: 'active',
            preApproved: true,
            nonce: newNonce(),
          });
          return reply.send({ ok: applied.ok, message: applied.message, applied });
        }
      }

      return reply.send({ ok: true, message: result.message });
    },
  );

  // -------------------------------------------------------------- actions
  app.post<{ Params: { id: string; name: string }; Body: Record<string, unknown> }>(
    '/api/kingdoms/:id/actions/:name',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;

      await query('UPDATE kingdoms SET last_active_at = now() WHERE id = $1', [owned.id]);

      const result = await executeAction(request.params.name, request.body ?? {}, {
        kingdomId: owned.id,
        source: 'active',
        nonce: newNonce(),
      });

      return reply.code(result.ok ? 200 : 400).send(result);
    },
  );

  // -------------------------------------------------------- notifications
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/kingdoms/:id/notifications',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;
      const limit = Math.min(200, Number.parseInt(request.query.limit ?? '50', 10) || 50);
      const rows = await query<NotificationRow>(
        'SELECT * FROM notifications WHERE kingdom_id = $1 ORDER BY created_at DESC LIMIT $2',
        [owned.id, limit],
      );
      return reply.send(rows.map(toNotificationDto));
    },
  );

  app.post<{ Params: { id: string; nid: string } }>(
    '/api/kingdoms/:id/notifications/:nid/read',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;
      await query(
        'UPDATE notifications SET read_at = now() WHERE id = $1 AND kingdom_id = $2 AND read_at IS NULL',
        [request.params.nid, owned.id],
      );
      return reply.send({ ok: true });
    },
  );

  // Bölgesel Duyum Akışı — salt-okunur (§10.4).
  app.get<{ Params: { id: string } }>(
    '/api/kingdoms/:id/bulletins',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;
      const rows = await query<{
        id: string;
        kind: 'routine_digest' | 'major_event';
        summary: string;
        related_kingdom_ids: string[];
        created_at: Date;
      }>(
        'SELECT * FROM region_bulletins WHERE kingdom_id = $1 ORDER BY created_at DESC LIMIT 40',
        [owned.id],
      );
      const dtos: RegionBulletinDto[] = rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        summary: r.summary,
        createdAt: r.created_at.toISOString(),
        relatedKingdomIds: r.related_kingdom_ids,
      }));
      return reply.send(dtos);
    },
  );

  // -------------------------------------------------------------- reports
  app.get<{ Params: { id: string } }>(
    '/api/kingdoms/:id/reports',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;

      const rows = await query<BattleReportRow & { attacker_name: string | null; defender_name: string | null }>(
        `SELECT r.*, a.name AS attacker_name, d.name AS defender_name
           FROM battle_reports r
           LEFT JOIN kingdoms a ON a.id = r.attacker_kingdom_id
           LEFT JOIN kingdoms d ON d.id = r.defender_kingdom_id
          WHERE r.attacker_kingdom_id = $1 OR r.defender_kingdom_id = $1
          ORDER BY r.created_at DESC LIMIT 50`,
        [owned.id],
      );

      const dtos: BattleReportDto[] = rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at.toISOString(),
        attackerKingdomId: r.attacker_kingdom_id ?? '',
        attackerKingdomName: r.attacker_name ?? 'Bilinmeyen',
        defenderKingdomId: r.defender_kingdom_id ?? '',
        defenderKingdomName: r.defender_name ?? 'Bilinmeyen',
        tileId: r.tile_id ?? '',
        intent: r.intent,
        mode: r.mode,
        attackerWon: r.attacker_won,
        attackPower: r.attack_power,
        defensePower: r.defense_power,
        attackerLosses: r.attacker_losses,
        defenderLosses: r.defender_losses,
        plunder: r.plunder,
        wallDamage: r.wall_damage,
        wallIntegrityAfter: r.wall_integrity_after ?? 0,
        narrative: r.narrative,
        capitalFell: r.capital_fell,
      }));

      return reply.send(dtos);
    },
  );

  // --------------------------------------------------------------- market
  app.get<{ Params: { id: string } }>(
    '/api/kingdoms/:id/market',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;

      const offers = await query<MarketOfferRow>(
        `SELECT * FROM market_offers WHERE channel_id = $1 AND status = 'open'
          ORDER BY created_at DESC LIMIT 100`,
        [owned.channel_id],
      );

      const info = await query<{ id: string; name: string; reputation: number; x: number; y: number }>(
        `SELECT k.id, k.name, k.reputation, t.x, t.y
           FROM kingdoms k JOIN map_tiles t ON t.id = k.capital_tile_id
          WHERE k.channel_id = $1`,
        [owned.channel_id],
      );
      const kingdomInfo = new Map(
        info.map((k) => [k.id, { name: k.name, reputation: k.reputation, x: k.x, y: k.y }]),
      );
      const selfInfo = kingdomInfo.get(owned.id);

      const agreements = await query<TradeAgreementRow & { a_name: string; b_name: string }>(
        `SELECT ta.*, ka.name AS a_name, kb.name AS b_name
           FROM trade_agreements ta
           JOIN kingdoms ka ON ka.id = ta.kingdom_a_id
           JOIN kingdoms kb ON kb.id = ta.kingdom_b_id
          WHERE (ta.kingdom_a_id = $1 OR ta.kingdom_b_id = $1) AND ta.status = 'active'`,
        [owned.id],
      );

      const agreementDtos: TradeAgreementDto[] = agreements.map((a) => {
        const isA = a.kingdom_a_id === owned.id;
        return {
          id: a.id,
          counterpartyKingdomId: isA ? a.kingdom_b_id : a.kingdom_a_id,
          counterpartyKingdomName: isA ? a.b_name : a.a_name,
          giveResource: isA ? a.resource_a : a.resource_b,
          giveAmount: isA ? a.amount_a : a.amount_b,
          receiveResource: isA ? a.resource_b : a.resource_a,
          receiveAmount: isA ? a.amount_b : a.amount_a,
          frequencyHours: a.frequency_hours,
          startedAt: a.started_at.toISOString(),
          nextDeliveryAt: a.next_delivery_at.toISOString(),
          status: a.status,
        };
      });

      // Pazar ilanları düz bir liste olarak döner; sürmekte olan ikili ticaret
      // anlaşmaları ayrı uçta, çünkü ikisi farklı tempoda tazeleniyor.
      void agreementDtos;
      return reply.send(
        toMarketOfferDtos(offers, {
          selfKingdomId: owned.id,
          selfPosition: selfInfo ? { x: selfInfo.x, y: selfInfo.y } : null,
          kingdomInfo,
        }),
      );
    },
  );

  // ------------------------------------------------------------ diplomacy
  app.get<{ Params: { id: string } }>(
    '/api/kingdoms/:id/diplomacy',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;

      const threads = await query<DiplomacyThreadRow>(
        `SELECT * FROM diplomacy_threads
          WHERE from_kingdom_id = $1 OR to_kingdom_id = $1
          ORDER BY updated_at DESC LIMIT 40`,
        [owned.id],
      );

      const threadIds = threads.map((t) => t.id);
      const turns =
        threadIds.length > 0
          ? await query<DiplomacyTurnRow>(
              'SELECT * FROM diplomacy_turns WHERE thread_id = ANY($1::uuid[]) ORDER BY created_at',
              [threadIds],
            )
          : [];

      const counterpartyIds = [
        ...new Set(threads.map((t) => (t.from_kingdom_id === owned.id ? t.to_kingdom_id : t.from_kingdom_id))),
      ];
      const counterparties =
        counterpartyIds.length > 0
          ? await query<{ id: string; name: string; reputation: number }>(
              'SELECT id, name, reputation FROM kingdoms WHERE id = ANY($1::uuid[])',
              [counterpartyIds],
            )
          : [];
      const infoById = new Map(counterparties.map((k) => [k.id, k]));
      const allNames = new Map<string, string>([[owned.id, owned.name]]);
      for (const k of counterparties) allNames.set(k.id, k.name);

      const dtos: DiplomacyThreadDto[] = threads.map((t) => {
        const counterpartyId = t.from_kingdom_id === owned.id ? t.to_kingdom_id : t.from_kingdom_id;
        const info = infoById.get(counterpartyId);
        return {
          id: t.id,
          counterpartyKingdomId: counterpartyId,
          counterpartyKingdomName: info?.name ?? 'Bilinmeyen',
          counterpartyReputation: Math.round(info?.reputation ?? 50),
          proposalType: t.proposal_type,
          status: t.status,
          terms: t.terms,
          createdAt: t.created_at.toISOString(),
          updatedAt: t.updated_at.toISOString(),
          transcript: turns
            .filter((turn) => turn.thread_id === t.id)
            .map((turn) => ({
              id: turn.id,
              speakerKingdomId: turn.speaker_kingdom_id,
              speakerKingdomName: allNames.get(turn.speaker_kingdom_id) ?? 'Bilinmeyen',
              isOwn: turn.speaker_kingdom_id === owned.id,
              message: turn.message,
              stance: turn.stance,
              createdAt: turn.created_at.toISOString(),
            })),
          // Oyuncu yalnızca **kendi** General'ını yönlendirebilir; karşı tarafa
          // asla doğrudan yazamaz (§10).
          canSteer: t.status === 'pending' && t.from_kingdom_id === owned.id,
        };
      });

      const protections = await query<
        ProtectionRelationshipRow & { protector_name: string; vassal_name: string }
      >(
        `SELECT p.*, kp.name AS protector_name, kv.name AS vassal_name
           FROM protection_relationships p
           JOIN kingdoms kp ON kp.id = p.protector_kingdom_id
           JOIN kingdoms kv ON kv.id = p.vassal_kingdom_id
          WHERE (p.protector_kingdom_id = $1 OR p.vassal_kingdom_id = $1) AND p.status = 'active'`,
        [owned.id],
      );

      const protectionDtos: ProtectionRelationshipDto[] = protections.map((p) => ({
        id: p.id,
        protectorKingdomId: p.protector_kingdom_id,
        protectorKingdomName: p.protector_name,
        vassalKingdomId: p.vassal_kingdom_id,
        vassalKingdomName: p.vassal_name,
        tributeRate: p.tribute_rate,
        startedAt: p.started_at.toISOString(),
        status: p.status,
        nextTributeAt: p.next_tribute_at.toISOString(),
      }));

      void protectionDtos;
      return reply.send(dtos);
    },
  );

  /** Kral'ın kendi General'ına yönlendirmesi ("ısrar et", "vazgeç"). */
  app.post<{ Params: { id: string; tid: string }; Body: { note?: string } }>(
    '/api/kingdoms/:id/diplomacy/:tid/steer',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;

      const note = (request.body?.note ?? '').trim().slice(0, 1000);
      if (!note) return reply.code(400).send({ error: 'Yönlendirme boş olamaz.' });

      const thread = await queryOne<DiplomacyThreadRow>(
        'SELECT * FROM diplomacy_threads WHERE id = $1',
        [request.params.tid],
      );
      if (!thread) return reply.code(404).send({ error: 'Görüşme bulunamadı.' });
      if (thread.from_kingdom_id !== owned.id && thread.to_kingdom_id !== owned.id) {
        return reply.code(403).send({ error: 'Bu görüşmenin tarafı değilsiniz.' });
      }

      await query(
        'UPDATE diplomacy_threads SET steering_note = $2, updated_at = now() WHERE id = $1',
        [thread.id, note],
      );

      return reply.send({ ok: true });
    },
  );

  // -------------------------------------------------------- defeat choice
  /**
   * §12: başkenti düşen oyuncu raporu gördükten sonra **kendisi** seçer.
   * Otomatik değil; bu yüzden ayrı bir uç.
   */
  app.post<{ Params: { id: string }; Body: { choice?: 'spectate' | 'restart_as_refugee' } }>(
    '/api/kingdoms/:id/defeat-choice',
    { preHandler: requireAuth },
    async (request, reply) => {
      const owned = await loadOwnedKingdom(request, reply, request.params.id);
      if (!owned) return;
      if (owned.status !== 'fallen') {
        return reply.code(400).send({ error: 'Bu krallık hâlâ ayakta.' });
      }

      const choice = request.body?.choice;
      if (choice === 'spectate') {
        await query(`UPDATE kingdoms SET status = 'spectating' WHERE id = $1`, [owned.id]);
        return reply.send({ ok: true, mode: 'spectating' });
      }

      if (choice === 'restart_as_refugee') {
        try {
          const result = await restartAsRefugee({
            userId: request.authUser!.id,
            fallenKingdomId: owned.id,
          });
          return reply.send({ ok: true, kingdomId: result.kingdom.id });
        } catch (error) {
          return reply.code(400).send({ error: (error as Error).message });
        }
      }

      return reply.code(400).send({ error: 'Geçersiz seçim.' });
    },
  );

  // ------------------------------------------------------------- settings
  /**
   * BYOK ayarları (§14.6). Anahtar yalnızca tanışma çağrısı başarılı olursa
   * kaydedilir — bozuk bir anahtar veritabanına yerleşmez (§14.7).
   */
  app.put<{
    Querystring: { kingdomId?: string };
    Body: { provider?: string; model?: string; apiKey?: string; baseUrl?: string; kingdomId?: string };
  }>('/api/settings/llm', { preHandler: requireAuth }, async (request, reply) => {
    // Ayarlar sayfası krallık kimliğini gövdede taşıyor; sorgu parametresi de
    // kabul ediliyor ki uç doğrudan da çağrılabilsin.
    const kingdomId = request.body?.kingdomId ?? request.query.kingdomId;
    if (!kingdomId) return reply.code(400).send({ error: 'kingdomId gerekli.' });

    const owned = await loadOwnedKingdom(request, reply, kingdomId);
    if (!owned) return;

    const provider = request.body?.provider as LlmProvider | undefined;
    const model = (request.body?.model ?? '').trim();
    const apiKey = (request.body?.apiKey ?? '').trim();

    if (!provider || !(LLM_PROVIDERS as readonly string[]).includes(provider)) {
      return reply.code(400).send({ error: 'Geçersiz sağlayıcı.' });
    }
    if (!model) return reply.code(400).send({ error: 'Model adı gerekli.' });
    if (!apiKey) return reply.code(400).send({ error: 'API anahtarı gerekli.' });
    if (provider === 'openai_compatible' && !request.body?.baseUrl) {
      return reply.code(400).send({ error: 'OpenAI-uyumlu sağlayıcı için baseUrl gerekli.' });
    }

    const onboarding = await loadOnboarding();
    if (!onboarding) {
      return reply.code(503).send({ error: 'LLM katmanı kullanılamıyor.' });
    }

    const result = await onboarding.runOnboarding({
      kingdomId: owned.id,
      provider,
      model,
      apiKey,
      baseUrl: request.body?.baseUrl,
    });

    const snapshot = await loadKingdomSnapshot(owned.id);
    const { toLlmStatusDto } = await import('./dto.js');

    return reply.code(result.ok ? 200 : 400).send({
      ok: result.ok,
      status: snapshot ? toLlmStatusDto(snapshot) : null,
      greeting: result.greeting,
      error: result.error,
    });
  });

  // ---------------------------------------------------------------- sağlık
  app.get('/api/health', async (_request, reply) => {
    const row = await queryOne<{ ok: number }>('SELECT 1 AS ok');
    return reply.send({ ok: row?.ok === 1, time: config.now().toISOString() });
  });
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

async function buildChatResponse(kingdom: KingdomRow) {
  const messages = await query<{
    id: string;
    role: 'king' | 'general' | 'system';
    content: string;
    actions: unknown[];
    is_passive_summary: boolean;
    created_at: Date;
  }>(
    `SELECT id, role, content, actions, is_passive_summary, created_at
       FROM chat_messages WHERE kingdom_id = $1
      ORDER BY created_at DESC LIMIT 60`,
    [kingdom.id],
  );

  const decisions = await query<PendingDecisionRow>(
    `SELECT * FROM pending_decisions WHERE kingdom_id = $1 AND status = 'awaiting' ORDER BY created_at`,
    [kingdom.id],
  );

  // Sessize düşen General için Kral'a gösterilecek hata (§14.6).
  const errored =
    kingdom.llm_last_error_at !== null &&
    (kingdom.llm_last_success_at === null ||
      kingdom.llm_last_error_at.getTime() > kingdom.llm_last_success_at.getTime());

  return {
    messages: messages.reverse().map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at.toISOString(),
      actions: m.actions,
      isPassiveSummary: m.is_passive_summary,
    })),
    pendingDecisions: decisions.map(toPendingDecisionDto),
    llmError: errored
      ? {
          kind: kingdom.llm_last_error_kind ?? 'unknown',
          message: 'General sessize düştü. Ayarlar sayfasından anahtarınızı kontrol edin.',
        }
      : null,
    quotaRemaining: kingdom.decree_quota_remaining,
  };
}

/**
 * LLM katmanı dinamik yüklenir; yüklenemezse API ayakta kalır ve yalnızca
 * General'a bağlı uçlar 503 döner. Formül-tabanlı her şey çalışmaya devam eder.
 */
interface GeneralModule {
  runGeneralTurn(input: {
    kingdomId: string;
    mode: 'active' | 'passive';
    kingMessage?: string;
  }): Promise<unknown>;
}

interface OnboardingModule {
  runOnboarding(input: {
    kingdomId: string;
    provider: LlmProvider;
    model: string;
    apiKey: string;
    baseUrl?: string | undefined;
  }): Promise<{ ok: boolean; greeting?: string; error?: string }>;
}

let generalModule: GeneralModule | null | undefined;
let onboardingModule: OnboardingModule | null | undefined;

async function loadGeneral(): Promise<GeneralModule | null> {
  if (generalModule !== undefined) return generalModule;
  try {
    generalModule = (await import('../llm/general.js')) as unknown as GeneralModule;
  } catch (error) {
    console.warn('[http] LLM katmanı yüklenemedi:', (error as Error).message);
    generalModule = null;
  }
  return generalModule;
}

async function loadOnboarding(): Promise<OnboardingModule | null> {
  if (onboardingModule !== undefined) return onboardingModule;
  try {
    onboardingModule = (await import('../llm/onboarding.js')) as unknown as OnboardingModule;
  } catch (error) {
    console.warn('[http] onboarding katmanı yüklenemedi:', (error as Error).message);
    onboardingModule = null;
  }
  return onboardingModule;
}

export { withTransaction, type CaravanRow };
