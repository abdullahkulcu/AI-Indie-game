import { useState } from "react";
import type { ChatMessage } from "../types";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  disabled?: boolean;
}

/** Free-text strategy chat with the player's own AI general. The system
 * prompt driving the model's behavior is never shown here - only the
 * player's own turns and the assistant's natural-language replies. */
export function ChatPanel({ messages, onSend, disabled }: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft("");
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className={`chat-message chat-message--${m.role}`}>
            <span className="chat-message__role">{m.role === "user" ? "Sen" : "General"}</span>
            <p>{m.content}</p>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="chat-empty">Generaline stratejini anlat: "Kuzeydeki ormanla ticaret yap", "Sinirdaki dusman birimi savustur"...</p>
        )}
      </div>
      <form onSubmit={submit} className="chat-input">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Stratejini yaz..."
          disabled={disabled}
        />
        <button type="submit" disabled={disabled}>
          Gonder
        </button>
      </form>
    </div>
  );
}
