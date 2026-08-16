import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../state/auth';

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, displayName.trim() || email.split('@')[0] || 'Kral');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Giriş başarısız oldu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app center-page">
      <div className="form-card">
        <div className="banner">
          <div className="crest">⚜</div>
          <div className="kingdom-name">KRALLIK SİMÜLASYONU</div>
          <div className="kingdom-sub">TAHT SİZİ BEKLİYOR</div>
        </div>

        <form className="panel" onSubmit={onSubmit}>
          <h2 className="panel-title">{mode === 'login' ? 'Saraya Giriş' : 'Yeni Hanedan'}</h2>

          {mode === 'register' && (
            <div className="field">
              <label htmlFor="displayName">Hitap Adınız</label>
              <input
                id="displayName"
                className="input-field"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="nickname"
                placeholder="Kral Aldric"
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="email">E-posta</label>
            <input
              id="email"
              className="input-field"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Parola</label>
            <input
              id="password"
              className="input-field"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Bekleyin…' : mode === 'login' ? 'Giriş Yap' : 'Kaydol'}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
              }}
            >
              {mode === 'login' ? 'Hesabım yok' : 'Hesabım var'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
