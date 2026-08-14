import { useState } from "react";
import { api } from "../api/client";
import type { AuthResult } from "../types";

interface AuthFormProps {
  onAuthenticated: (result: AuthResult) => void;
}

export function AuthForm({ onAuthenticated }: AuthFormProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result =
        mode === "login" ? await api.login(email, password) : await api.register(username, email, password);
      onAuthenticated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <form onSubmit={handleSubmit} className="auth-form">
        <h1>AI Indie Game</h1>
        <p className="auth-subtitle">
          Kendi AI generaline strateji anlat, o karar alsin ve haritada uygulasin.
        </p>
        <div className="auth-tabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Giris yap
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            Kayit ol
          </button>
        </div>
        {mode === "register" && (
          <input
            placeholder="Kullanici adi"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        )}
        <input
          type="email"
          placeholder="E-posta"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Sifre"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {mode === "login" ? "Giris yap" : "Kayit ol"}
        </button>
      </form>
    </div>
  );
}
