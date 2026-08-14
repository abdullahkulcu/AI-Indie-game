import { useCallback, useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { api } from "./api/client";
import { connectSocket } from "./api/socket";
import { AuthForm } from "./components/AuthForm";
import { ApiKeyModal } from "./components/ApiKeyModal";
import { MapGrid } from "./components/MapGrid";
import { ChatPanel } from "./components/ChatPanel";
import { PlayerHud } from "./components/PlayerHud";
import type { AuthResult, ChatMessage, GameStateSnapshot, Resources } from "./types";

const TOKEN_STORAGE_KEY = "ai-indie-game:token";

export function App() {
  const [session, setSession] = useState<AuthResult | null>(null);
  const [snapshot, setSnapshot] = useState<GameStateSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [resources, setResources] = useState<Resources | null>(null);
  const [apiKeyConnected, setApiKeyConnected] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) return;
    const player = JSON.parse(stored) as AuthResult;
    setSession(player);
  }, []);

  useEffect(() => {
    if (!session) return;
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(session));

    const s = connectSocket(session.token);
    setSocket(s);

    s.on("state:update", (next: GameStateSnapshot) => setSnapshot(next));
    s.on("chat:reply", () => {
      api.getChatHistory(session.token).then(setMessages).catch(() => undefined);
    });

    Promise.all([
      api.getMap(session.token),
      api.getChatHistory(session.token),
      api.me(session.token),
    ]).then(([map, history, me]) => {
      setSnapshot(map);
      setMessages(history);
      setResources(me.resources);
      setApiKeyConnected(me.apiKeyConnected);
      if (!me.apiKeyConnected) setShowApiKeyModal(true);
    });

    return () => {
      s.disconnect();
    };
  }, [session]);

  useEffect(() => {
    if (!snapshot || !session) return;
    const mine = snapshot.resources.find((r) => r.playerId === session.player.id);
    if (mine) setResources(mine);
  }, [snapshot, session]);

  const sendChat = useCallback(
    (message: string) => {
      if (!socket) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          playerId: session?.player.id ?? "",
          role: "user",
          content: message,
          createdAt: new Date().toISOString(),
        },
      ]);
      socket.emit("chat:send", { message });
    },
    [socket, session],
  );

  async function handleConnectApiKey(apiKey: string) {
    if (!session) return;
    await api.connectApiKey(session.token, apiKey);
    setApiKeyConnected(true);
  }

  function logout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    socket?.disconnect();
    setSession(null);
    setSnapshot(null);
    setMessages([]);
  }

  if (!session) {
    return <AuthForm onAuthenticated={setSession} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <PlayerHud
          username={session.player.username}
          resources={resources}
          tickNumber={snapshot?.tickNumber ?? 0}
          apiKeyConnected={apiKeyConnected}
        />
        <div className="app-header__actions">
          {!apiKeyConnected && (
            <button onClick={() => setShowApiKeyModal(true)}>API anahtari bagla</button>
          )}
          <button onClick={logout}>Cikis</button>
        </div>
      </header>
      <main className="app-main">
        <MapGrid snapshot={snapshot} selfPlayerId={session.player.id} />
        <ChatPanel messages={messages} onSend={sendChat} disabled={!apiKeyConnected} />
      </main>
      {showApiKeyModal && (
        <ApiKeyModal onSubmit={handleConnectApiKey} onClose={() => setShowApiKeyModal(false)} />
      )}
    </div>
  );
}
