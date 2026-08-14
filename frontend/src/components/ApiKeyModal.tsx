import { useState } from "react";

interface ApiKeyModalProps {
  onSubmit: (apiKey: string) => Promise<void>;
  onClose: () => void;
}

/** BYOK: the player connects their own OpenAI key. It is sent once over TLS,
 * encrypted at rest server-side, and never displayed again. */
export function ApiKeyModal({ onSubmit, onClose }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(apiKey);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>OpenAI API Anahtarini Baglayin</h2>
        <p>
          Kendi OpenAI API anahtariniz sunucuda sifreli olarak saklanir ve sadece sizin
          generaliniz icin kullanilir.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
            minLength={20}
          />
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              Vazgec
            </button>
            <button type="submit" disabled={submitting}>
              Baglan
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
