/**
 * HTTP istemcisi.
 *
 * Tüm gövde tipleri `@krallik/shared`ten geliyor: sözleşme değişirse burası
 * derlenmez, yani frontend sessizce eskimez.
 */

import type {
  ActionResult,
  ApiError,
  AuthResponse,
  AuthUser,
  BattleReportDto,
  ChannelListResponse,
  ChatMessageDto,
  ChatRequest,
  ChatResponse,
  DefeatChoiceRequest,
  DiplomacyThreadDto,
  KingdomStateDto,
  LlmSettingsRequest,
  LlmSettingsResponse,
  MarketOfferDto,
  NotificationDto,
  PendingDecisionDto,
  RealmViewDto,
  RegionBulletinDto,
} from '@krallik/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
const TOKEN_KEY = 'krallik.token';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;

  constructor(status: number, body: ApiError | null, fallback: string) {
    super(body?.error ?? fallback);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body?.code;
    this.details = body?.details;
  }
}

// --- Oturum anahtarı ---------------------------------------------------------

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Gizli sekme / depolama kapalı: oturum bellekte kalmaz ama uygulama çalışır.
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* yoksay */
  }
}

// --- Çekirdek ----------------------------------------------------------------

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    let parsed: ApiError | null = null;
    try {
      parsed = (await res.json()) as ApiError;
    } catch {
      parsed = null;
    }
    throw new ApiRequestError(res.status, parsed, `İstek başarısız (${res.status})`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Uç noktalar -------------------------------------------------------------

export const api = {
  auth: {
    register: (email: string, password: string, displayName: string) =>
      request<AuthResponse>('POST', '/api/auth/register', { email, password, displayName }),
    login: (email: string, password: string) =>
      request<AuthResponse>('POST', '/api/auth/login', { email, password }),
    me: () => request<AuthUser>('GET', '/api/auth/me'),
  },

  channels: {
    list: () => request<ChannelListResponse>('GET', '/api/channels'),
    join: (channelId: string, kingdomName: string) =>
      request<{ kingdomId: string }>('POST', `/api/channels/${channelId}/join`, {
        channelId,
        kingdomName,
      }),
  },

  kingdom: {
    state: (id: string) => request<KingdomStateDto>('GET', `/api/kingdoms/${id}`),
    realm: (id: string) => request<RealmViewDto>('GET', `/api/kingdoms/${id}/realm`),

    chatHistory: (id: string) => request<ChatMessageDto[]>('GET', `/api/kingdoms/${id}/chat`),
    sendChat: (id: string, message: string) => {
      const payload: ChatRequest = { message };
      return request<ChatResponse>('POST', `/api/kingdoms/${id}/chat`, payload);
    },

    notifications: (id: string) =>
      request<NotificationDto[]>('GET', `/api/kingdoms/${id}/notifications`),
    markNotificationRead: (id: string, notificationId: string) =>
      request<void>('POST', `/api/kingdoms/${id}/notifications/${notificationId}/read`),

    bulletins: (id: string) => request<RegionBulletinDto[]>('GET', `/api/kingdoms/${id}/bulletins`),

    decisions: (id: string) => request<PendingDecisionDto[]>('GET', `/api/kingdoms/${id}/decisions`),
    respondToDecision: (id: string, decisionId: string, response: 'approve' | 'reject') =>
      request<ActionResult>('POST', `/api/kingdoms/${id}/decisions/${decisionId}`, { response }),

    market: (id: string) => request<MarketOfferDto[]>('GET', `/api/kingdoms/${id}/market`),
    diplomacy: (id: string) => request<DiplomacyThreadDto[]>('GET', `/api/kingdoms/${id}/diplomacy`),
    steerDiplomacy: (id: string, threadId: string, note: string) =>
      request<ActionResult>('POST', `/api/kingdoms/${id}/diplomacy/${threadId}/steer`, { note }),

    /**
     * Genel aksiyon gönderimi. Gövde doğrudan aracın argüman nesnesidir; hangi
     * argümanların geçerli olduğu `@krallik/shared`teki tool tanımlarında yaşar
     * ve doğrulama sunucuda yapılır (GDD §15.5).
     */
    action: (id: string, actionName: string, args: Record<string, unknown>) =>
      request<ActionResult>('POST', `/api/kingdoms/${id}/actions/${actionName}`, args),

    reports: (id: string) => request<BattleReportDto[]>('GET', `/api/kingdoms/${id}/reports`),
    defeatChoice: (id: string, choice: DefeatChoiceRequest['choice']) =>
      request<{ ok: boolean }>('POST', `/api/kingdoms/${id}/defeat-choice`, { choice }),
  },

  settings: {
    saveLlm: (payload: LlmSettingsRequest) =>
      request<LlmSettingsResponse>('PUT', '/api/settings/llm', payload),
  },
};
