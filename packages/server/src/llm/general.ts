/**
 * Kral↔General turu — GDD §14.1, §14.2, §14.4, §14.5.
 *
 * Buradaki döngü modelin *önerilerini* toplar ve `executeAction`'a taşır.
 * Kural doğrulaması, kota düşürme, kaynak/önkoşul/mesafe kontrolü ve büyük
 * kararın onaya düşürülmesi tamamen aksiyon katmanının işidir (§15.5); bu dosya
 * hiçbirini tekrarlamaz. Buranın işi anlatmak, sadakati yürütmek ve turu
 * kalıcılaştırmak.
 *
 * `runGeneralTurn` **asla fırlatmaz**. Sağlayıcı hatası, bozuk anahtar, ağ
 * kesintisi — hepsi "General sessize düştü" durumuna çevrilir (§14.6): krallık
 * yaşamaya devam eder, yalnızca yeni inisiyatif durur.
 */

import {
  BALANCE,
  BUILDINGS,
  GENERAL_TOOLS,
  UNITS,
  armyUnitCount,
  assessRisk,
  buildingCostAtLevel,
  deepExcavationCost,
  generalCompliance,
  loyaltyAfterForcedOrder,
  loyaltyAfterSoundOrder,
  type ActionErrorCode,
  type ActionResult,
  type ArmyComposition,
  type BuildingType,
  type DecisionTier,
  type LlmErrorKind,
  type LlmMessage,
  type LlmToolCall,
  type LlmToolResult,
  type Resource,
  type ResourceBundle,
  type RiskAssessment,
  type UnitType,
} from '@krallik/shared';
import { config } from '../config.js';
import { newNonce } from '../crypto.js';
import { query, withTransaction } from '../db/pool.js';
import type { PendingDecisionRow } from '../db/rows.js';
import { notify } from '../game/notifications.js';
import { deployableGarrisonOf, loadKingdomSnapshot, type KingdomSnapshot } from '../game/state.js';
import { executeAction, type ActionContext } from '../game/actions.js';
import { buildKingdomContext } from './context.js';
import { toLlmError } from './errors.js';
import { loadKingdomLlmConfig, recordLlmError, recordLlmSuccess } from './keys.js';
import { generalSystemPrompt } from './prompt.js';
import { createAdapter, runChat } from './provider.js';

const TOOL_NAMES = new Set(GENERAL_TOOLS.map((tool) => tool.name));

/** Kral'ın "yine de yap" dediğini tanıyan kalıplar (§14.5 ısrar). */
const INSISTENCE_PATTERNS = [
  /ısrar/i,
  /yine de/i,
  /emrediyorum/i,
  /dediğimi yap/i,
  /yap dedim/i,
  /derhal/i,
  /itiraz etme/i,
  /onaylıyorum/i,
  /onayladım/i,
  /tartışma/i,
];

/** Onaylanmış bir kararın "hâlâ taze" sayıldığı pencere. */
const APPROVAL_WINDOW_MS = 2 * 3_600_000;

export interface ExecutedAction {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  message: string;
  errorCode: ActionErrorCode | null;
  quotaSpent: number;
  tier: DecisionTier;
  pendingDecisionId: string | null;
}

export interface GeneralTurnInput {
  kingdomId: string;
  mode: 'active' | 'passive';
  /** Aktif modda Kral'ın mesajı; pasif modda yok. */
  kingMessage?: string;
  now?: Date;
  /** Sadakat zarı — testlerde sabitlenebilsin diye dışarıdan verilebilir. */
  randomRoll?: number;
}

export interface GeneralTurnResult {
  ok: boolean;
  /** General sessize düştü mü (§14.6). */
  silent: boolean;
  reply: string;
  actions: ExecutedAction[];
  pendingDecisionIds: string[];
  llmError: { kind: LlmErrorKind; message: string } | null;
  loyalty: number;
  usage: { inputTokens: number; outputTokens: number } | null;
}

// ---------------------------------------------------------------------------
// Kalıcılaştırma yardımcıları
// ---------------------------------------------------------------------------

export interface ChatMessageInput {
  kingdomId: string;
  role: 'king' | 'general' | 'system';
  content: string;
  actions?: ExecutedAction[];
  isPassiveSummary?: boolean;
  tokenUsage?: { inputTokens: number; outputTokens: number } | null;
}

export async function appendChatMessage(input: ChatMessageInput): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `INSERT INTO chat_messages (kingdom_id, role, content, actions, is_passive_summary, token_usage)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.kingdomId,
      input.role,
      input.content,
      JSON.stringify(input.actions ?? []),
      input.isPassiveSummary ?? false,
      input.tokenUsage
        ? JSON.stringify({ input: input.tokenUsage.inputTokens, output: input.tokenUsage.outputTokens })
        : null,
    ],
  );
  return rows[0]?.id ?? null;
}

/**
 * Onaya düşen kararın üstüne General'ın gerekçesini yazar.
 *
 * Satırı `executeAction` açar (risk kararı orada verilir); tavsiye metnini
 * ancak burada biliyoruz, çünkü onu üreten modelin kendisi.
 */
async function attachRecommendation(decisionId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  await query('UPDATE pending_decisions SET general_recommendation_text = $2 WHERE id = $1', [
    decisionId,
    trimmed.slice(0, 2000),
  ]);
}

// ---------------------------------------------------------------------------
// Risk tahmini (yalnızca anlatım ve sadakat için)
// ---------------------------------------------------------------------------

/**
 * Kaynakların kaba altın karşılığı.
 *
 * Bu tablo bir ekonomi modeli değil; `assessRisk`'in "hazinenin ne kadarını
 * harcıyor" eşiğini odun/taş ağırlıklı harcamalarda da anlamlı kılmak için
 * var. **Bağlayıcı karar bu sayıya dayanmaz** — aksiyon katmanı riski gerçek
 * maliyetlerle yeniden hesaplar (§15.5). Buradaki tahmin yalnızca General'ın
 * ne diyeceğini ve sadakat kaybının şiddetini belirler.
 */
const GOLD_VALUE: Partial<Record<Resource, number>> = {
  gold: 1,
  wood: 0.5,
  stone: 0.5,
  food: 0.4,
  ale: 0.8,
  iron: 1.5,
  weapons: 3,
};

function goldValueOf(bundle: ResourceBundle): number {
  let total = 0;
  for (const [resource, amount] of Object.entries(bundle) as [Resource, number][]) {
    total += (amount ?? 0) * (GOLD_VALUE[resource] ?? 0.3);
  }
  return Math.round(total);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArmy(value: unknown): ArmyComposition {
  const army: ArmyComposition = {};
  for (const [key, count] of Object.entries(asRecord(value))) {
    if (typeof count === 'number' && count > 0) army[key as UnitType] = count;
  }
  return army;
}

function estimatedCostOf(
  call: LlmToolCall,
  snapshot: KingdomSnapshot,
): number {
  const args = call.arguments;
  switch (call.name) {
    case 'build_structure': {
      const type = args.building_type;
      const level = args.target_level;
      if (typeof type !== 'string' || !(type in BUILDINGS)) return 0;
      const targetLevel = typeof level === 'number' ? level : 1;
      return goldValueOf(buildingCostAtLevel(type as BuildingType, targetLevel));
    }
    case 'train_unit': {
      const type = args.unit_type;
      const count = typeof args.count === 'number' ? args.count : 0;
      if (typeof type !== 'string' || !(type in UNITS)) return 0;
      const unit = UNITS[type as UnitType];
      return goldValueOf(unit.cost) * Math.max(0, count);
    }
    case 'hire_mercenaries': {
      const count = typeof args.count === 'number' ? args.count : 0;
      return goldValueOf(UNITS.mercenary.cost) * Math.max(0, count);
    }
    case 'host_festival':
      return goldValueOf(BALANCE.festival.cost);
    case 'send_caravan':
      return BALANCE.caravan.goldCost;
    case 'deep_excavation': {
      const building = snapshot.buildings.find((b) => b.id === args.building_id);
      return deepExcavationCost(building?.deep_excavations_used ?? 0);
    }
    case 'propose_troop_rental':
      return typeof args.fee_gold === 'number' ? args.fee_gold : 0;
    case 'post_market_offer': {
      const resource = args.offer_resource;
      const amount = typeof args.offer_amount === 'number' ? args.offer_amount : 0;
      if (typeof resource !== 'string') return 0;
      return goldValueOf({ [resource as Resource]: amount });
    }
    default:
      return 0;
  }
}

/**
 * Aksiyonun kademesini önden tahmin eder.
 *
 * Bağlayıcı karar `executeAction`'da verilir; buradaki kopya yalnızca General'ın
 * "bu büyük bir karar, önce gerekçemi yazayım" diyebilmesi ve ısrar hâlinde
 * sadakat kaybının şiddetini ölçeklemek için. Aynı saf fonksiyonu (`assessRisk`)
 * kullandığımız için iki taraf birbirinden sapmaz.
 */
function estimateRisk(call: LlmToolCall, snapshot: KingdomSnapshot): RiskAssessment {
  const units = call.name === 'move_army' ? asArmy(call.arguments.units) : {};
  const intent = typeof call.arguments.intent === 'string' ? call.arguments.intent : undefined;
  const proposalType =
    typeof call.arguments.proposal_type === 'string' ? call.arguments.proposal_type : undefined;

  return assessRisk({
    action: call.name,
    estimatedCost: estimatedCostOf(call, snapshot),
    treasuryGold: snapshot.kingdom.gold,
    unitsCommitted: armyUnitCount(units),
    garrisonSize: armyUnitCount(deployableGarrisonOf(snapshot)),
    ...(intent === undefined ? {} : { intent }),
    ...(proposalType === undefined ? {} : { proposalType }),
  });
}

export function detectInsistence(message: string): boolean {
  return INSISTENCE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Kral'ın yakın zamanda onayladığı büyük kararlar. Israr ancak somut bir onayla
 * birleştiğinde "zorlanmış emir" sayılır — böylece sadece sinirli konuşan bir
 * Kral sadakat kaybetmez, gerçekten riskli emri dayatan Kral kaybeder.
 */
async function loadRecentApprovals(kingdomId: string, now: Date): Promise<PendingDecisionRow[]> {
  return query<PendingDecisionRow>(
    `SELECT * FROM pending_decisions
      WHERE kingdom_id = $1 AND status = 'approved' AND resolved_at IS NOT NULL AND resolved_at > $2
      ORDER BY resolved_at DESC LIMIT 5`,
    [kingdomId, new Date(now.getTime() - APPROVAL_WINDOW_MS)],
  );
}

// ---------------------------------------------------------------------------
// Tur
// ---------------------------------------------------------------------------

function emptyResult(loyalty: number): GeneralTurnResult {
  return {
    ok: false,
    silent: true,
    reply: '',
    actions: [],
    pendingDecisionIds: [],
    llmError: null,
    loyalty,
    usage: null,
  };
}

export async function runGeneralTurn(input: GeneralTurnInput): Promise<GeneralTurnResult> {
  const now = input.now ?? config.now();
  const kingdomId = input.kingdomId;

  // `BALANCE` `as const` olduğu için literal tip taşıyor; burada değeri
  // güncelleyeceğimiz için genişletiyoruz.
  let loyalty: number = BALANCE.general.loyaltyStart;

  try {
    const snapshot = await loadKingdomSnapshot(kingdomId);
    if (!snapshot) return emptyResult(loyalty);
    loyalty = snapshot.kingdom.general_loyalty;

    // Düşmüş/izleyici krallıkta General diye biri kalmadı.
    if (snapshot.kingdom.status !== 'active') return emptyResult(loyalty);

    const kingMessage = input.mode === 'active' ? (input.kingMessage ?? '').trim() : '';
    if (kingMessage.length > 0) {
      await appendChatMessage({ kingdomId, role: 'king', content: kingMessage });
    }

    const llm = await loadKingdomLlmConfig(kingdomId);
    if (!llm) {
      // Anahtar yok/çözülemedi: sessize düş, ama krallığı yaşatmaya devam et.
      await recordLlmError(kingdomId, 'auth', 'Krallığın bağlı bir LLM anahtarı yok.', now);
      return {
        ...emptyResult(loyalty),
        llmError: { kind: 'auth', message: 'API anahtarı tanımlı değil.' },
      };
    }

    const adapter = createAdapter(llm.provider, {
      apiKey: llm.apiKey,
      model: llm.model,
      baseUrl: llm.baseUrl,
    });

    const context = await buildKingdomContext({ snapshot, mode: input.mode, now });

    // --- Sadakat: bu turda General ne kadar istekli? ----------------------
    const roll = input.randomRoll ?? Math.random();
    const compliance = generalCompliance(loyalty, roll);
    if (!compliance.comply) {
      const refusal = refusalText(loyalty);
      await appendChatMessage({ kingdomId, role: 'general', content: refusal });
      return {
        ok: true,
        silent: false,
        reply: refusal,
        actions: [],
        pendingDecisionIds: [],
        llmError: null,
        loyalty,
        usage: null,
      };
    }

    const insisted = kingMessage.length > 0 && detectInsistence(kingMessage);
    const approvals = insisted ? await loadRecentApprovals(kingdomId, now) : [];

    // --- Konuşma --------------------------------------------------------
    const messages: LlmMessage[] = [
      { role: 'user', content: `${context.text}\n\n${briefing(input.mode, kingMessage, compliance.delaySeconds > 0)}` },
    ];

    const executed: ExecutedAction[] = [];
    const pendingDecisionIds: string[] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let reply = '';
    let forcedSeverity = 0;
    let sluggishSkipped = false;

    for (let round = 0; round < config.llmMaxToolRounds; round += 1) {
      const response = await runChat(adapter, {
        system: generalSystemPrompt(),
        messages,
        tools: [...GENERAL_TOOLS],
      });

      if (response.usage) {
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;
      }
      if (response.text.length > 0) reply = response.text;

      if (response.toolCalls.length === 0) break;

      messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      });

      const toolResults: LlmToolResult[] = [];
      for (const call of response.toolCalls) {
        if (!TOOL_NAMES.has(call.name)) {
          toolResults.push({
            toolCallId: call.id,
            content: JSON.stringify({ ok: false, error_code: 'invalid_arguments', message: `Böyle bir araç yok: ${call.name}` }),
            isError: true,
          });
          continue;
        }

        // Sadakat düşükken General ağırdan alır: tur başına tek işi yapar,
        // gerisini "sonra" der. Aksiyon katmanında gecikmeli uygulama kavramı
        // yok, bu yüzden isteksizliği *iş hacmini kısarak* modelliyoruz.
        if (compliance.delaySeconds > 0 && executed.length >= 1) {
          sluggishSkipped = true;
          toolResults.push({
            toolCallId: call.id,
            content: JSON.stringify({
              ok: false,
              error_code: 'rate_limited',
              message: 'General bu turda daha fazlasını üstlenmiyor; bir sonraki tura bırakıldı.',
            }),
            isError: true,
          });
          continue;
        }

        const risk = estimateRisk(call, snapshot);
        const approval = approvals.find(
          (decision) => decision.proposed_action_json.name === call.name,
        );
        const preApproved = insisted && approval !== undefined;

        const actionContext: ActionContext = {
          kingdomId,
          source: input.mode === 'active' ? 'active' : 'passive',
          nonce: newNonce(),
          now,
        };
        if (preApproved) actionContext.preApproved = true;

        let result: ActionResult;
        try {
          result = await executeAction(call.name, call.arguments, actionContext);
        } catch (error) {
          // Aksiyon katmanındaki bir arıza turu düşürmemeli; model hatayı
          // görsün ve başka bir yol denesin.
          result = {
            ok: false,
            message: `Aksiyon yürütülemedi: ${(error as Error).message}`,
            errorCode: 'internal_error',
          };
        }

        if (result.pendingDecisionId) {
          pendingDecisionIds.push(result.pendingDecisionId);
          await attachRecommendation(
            result.pendingDecisionId,
            response.text.length > 0 ? response.text : defaultRecommendation(call, risk),
          );
        }

        if (preApproved && result.ok) {
          forcedSeverity = Math.max(forcedSeverity, risk.severity, approval.risk_severity);
        }

        executed.push({
          name: call.name,
          arguments: call.arguments,
          ok: result.ok,
          message: result.message,
          errorCode: result.errorCode ?? null,
          quotaSpent: result.quotaSpent ?? 0,
          tier: risk.tier,
          pendingDecisionId: result.pendingDecisionId ?? null,
        });

        toolResults.push({
          toolCallId: call.id,
          content: JSON.stringify({
            ok: result.ok,
            message: result.message,
            error_code: result.errorCode ?? null,
            quota_spent: result.quotaSpent ?? 0,
            pending_decision_id: result.pendingDecisionId ?? null,
            data: result.data ?? null,
          }),
          isError: !result.ok,
        });
      }

      messages.push({ role: 'user', content: '', toolResults });
    }

    // --- Sadakat güncellemesi -------------------------------------------
    const nextLoyalty = nextLoyaltyOf(loyalty, executed, forcedSeverity);
    if (nextLoyalty !== loyalty) {
      await query('UPDATE kingdoms SET general_loyalty = $2 WHERE id = $1', [kingdomId, nextLoyalty]);
      loyalty = nextLoyalty;
    }

    if (reply.length === 0) {
      reply = executed.length > 0 ? summarize(executed) : 'Emrinizi bekliyorum Efendimiz.';
    }
    if (sluggishSkipped) {
      reply += '\n\n(Gerisini bir sonraki tura bıraktım Efendimiz.)';
    }

    // --- Kalıcılaştırma --------------------------------------------------
    await appendChatMessage({
      kingdomId,
      role: 'general',
      content: reply,
      actions: executed,
      isPassiveSummary: input.mode === 'passive',
      tokenUsage: usage.inputTokens > 0 || usage.outputTokens > 0 ? usage : null,
    });

    if (input.mode === 'passive') {
      await withTransaction(async (tx) => {
        await notify(tx, {
          kingdomId,
          kind: 'passive_summary',
          severity: pendingDecisionIds.length > 0 ? 'warning' : 'info',
          title: 'Yokluğunda şunları yaptım',
          body: `${summarize(executed)}${
            pendingDecisionIds.length > 0
              ? `\n\n${pendingDecisionIds.length} karar onayınızı bekliyor Efendimiz.`
              : ''
          }`,
          payload: { actionCount: executed.length, pendingDecisionIds },
        });
      });
      await query('UPDATE kingdoms SET last_passive_run_at = $2 WHERE id = $1', [kingdomId, now]);
    }

    await recordLlmSuccess(kingdomId, now);

    return {
      ok: true,
      silent: false,
      reply,
      actions: executed,
      pendingDecisionIds,
      llmError: null,
      loyalty,
      usage: usage.inputTokens > 0 || usage.outputTokens > 0 ? usage : null,
    };
  } catch (error) {
    // Buraya düşen her şey "General sessize düştü"dür (§14.6). Krallığın
    // formül-tabanlı süreçleri (üretim, kuyruklar) tick servisinde döner.
    const llmError = toLlmError(error);
    try {
      await recordLlmError(kingdomId, llmError.kind, llmError.message, now);
    } catch {
      // Bildirim yazılamıyorsa da turu sessizce bitiriyoruz; veritabanı
      // erişilemez durumdaysa çağıran katmanın zaten daha büyük derdi var.
    }
    return {
      ...emptyResult(loyalty),
      llmError: { kind: llmError.kind, message: llmError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// Metin üreticileri
// ---------------------------------------------------------------------------

/** Turun görev tanımı — bağlam paketinin hemen ardına eklenir. */
function briefing(mode: 'active' | 'passive', kingMessage: string, sluggish: boolean): string {
  const reluctance = sluggish
    ? '\n(İçinden: Kral son zamanlarda seni zor durumlarda bıraktı. İsteksizsin; bu turda en fazla bir işi üstlen ve bunu soğuk bir üslupla belli et.)'
    : '';

  if (mode === 'passive') {
    return `# GÖREV — PASİF TUR
Kral şu an Meclis'te değil. Strateji notuna ve yukarıdaki duruma bakarak bu saatin kararlarını sen vereceksin.
- Elindeki emir kotasının tamamını tek bir tutarlı **karar paketi** olarak harca; birbirini tamamlayan aksiyonlar seç.
- Büyük/riskli bir adım gerekiyorsa uygulamayı zorlama: gerekçeni yaz, karar Kral'ın onayına düşecek.
- Sonunda Kral'a "yokluğunda şunları yaptım" diyeceğin kısa bir özet yaz.${reluctance}`;
  }

  return `# KRAL'IN EMRİ
${kingMessage.length > 0 ? kingMessage : '(Kral bir şey söylemedi; kısa bir durum özeti geç ve öneride bulun.)'}${reluctance}`;
}

function refusalText(loyalty: number): string {
  return [
    'Efendimiz, bu emri bu hâlde yerine getirmeyeceğim.',
    'Son kararlarınız kaleyi ve halkı defalarca gereksiz riske attı; bugün kılıcımı o yöne çeviremem.',
    `Sadakatim ${Math.round(loyalty)} seviyesine indi. Güveni onarmak isterseniz önce krallığın temeline dönelim — sonra emirlerinizi yeniden konuşuruz.`,
  ].join(' ');
}

function defaultRecommendation(call: LlmToolCall, risk: RiskAssessment): string {
  return `General'in önerisi: ${call.name} — ${risk.reasons.join(' ') || 'Kral onayı gerektiren bir adım.'}`;
}

function summarize(actions: ExecutedAction[]): string {
  if (actions.length === 0) return 'Bu turda yeni bir emir uygulanmadı Efendimiz.';
  return actions
    .map((action) => `• ${action.name}: ${action.ok ? action.message : `başarısız — ${action.message}`}`)
    .join('\n');
}

/**
 * Sadakatin tur sonundaki değeri (§14.5).
 *
 * Zorlanmış riskli emir varsa kayıp, yoksa ve tur makul geçtiyse küçük bir
 * kazanım. Başarısız/boş turlar sadakati değiştirmez — General'ın kendi hatası
 * Kral'ın güvenilirliğine dair bir şey söylemez.
 */
export function nextLoyaltyOf(
  loyalty: number,
  actions: ExecutedAction[],
  forcedSeverity: number,
): number {
  if (forcedSeverity > 0) return loyaltyAfterForcedOrder(loyalty, forcedSeverity);
  const soundWork = actions.some((action) => action.ok && action.tier === 'routine');
  return soundWork ? loyaltyAfterSoundOrder(loyalty) : loyalty;
}
