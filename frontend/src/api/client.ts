import type { AuthResult, Channel, ChatMessage, GameStateSnapshot, Player, Resources } from "../types";

const API_URL = import.meta.env.VITE_API_URL;

export class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.formErrors?.join(", ") ?? body?.error ?? response.statusText;
    throw new ApiError(typeof message === "string" ? message : "Bilinmeyen hata");
  }
  return body as T;
}

export interface MeResponse {
  playerId: string;
  channelId: string | null;
  resources: Resources | null;
  apiKeyConnected: boolean;
}

export interface SendChatResponse {
  reply: string | null;
  actions: Array<{ action: unknown; status: "accepted" | "rejected"; reason: string | null }>;
  snapshot: GameStateSnapshot;
}

export const api = {
  register: (username: string, email: string, password: string) =>
    request<AuthResult>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    }),
  login: (email: string, password: string) =>
    request<AuthResult>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: (token: string) => request<MeResponse>("/auth/me", {}, token),
  connectApiKey: (token: string, apiKey: string) =>
    request<{ connected: boolean }>(
      "/auth/api-key",
      { method: "POST", body: JSON.stringify({ apiKey }) },
      token,
    ),
  getMap: (token: string) => request<GameStateSnapshot>("/map", {}, token),
  getChannels: (token: string) => request<Channel[]>("/channels", {}, token),
  joinChannel: (token: string, channelId: string) =>
    request<{ channelId: string }>(
      `/channels/${channelId}/join`,
      { method: "POST", body: "{}" },
      token,
    ),
  getPlayers: (token: string) => request<Player[]>("/players", {}, token),
  getChatHistory: (token: string) => request<ChatMessage[]>("/chat/history", {}, token),
  sendChat: (token: string, message: string) =>
    request<SendChatResponse>(
      "/chat/send",
      { method: "POST", body: JSON.stringify({ message }) },
      token,
    ),
};
