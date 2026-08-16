/**
 * BYOK ayarları — GDD §14.6 / §14.7.
 *
 * Anahtar sunucuda şifreli saklanır ve hiçbir günlüğe yazılmaz; bu, oyuncunun
 * ekranda da görmesi gereken bir söz olduğu için forma yazılı olarak konuldu.
 * Bağlantı kurulduğunda General'ın tanışma selamı (onboarding) gösterilir.
 */

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { LlmProvider, LlmSettingsResponse, LlmStatusDto } from '@krallik/shared';
import { LLM_PROVIDERS } from '@krallik/shared';
import { api } from '../api/client';
import { useRouter } from '../state/router';
import { PROVIDER_TR, timeAgo } from '../lib/format';

export function SettingsPage({ kingdomId }: { kingdomId: string | null }) {
  const { navigate } = useRouter();
  const [provider, setProvider] = useState<LlmProvider>('anthropic');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [status, setStatus] = useState<LlmStatusDto | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Mevcut durumu ve channel kısıtını krallık durumundan okuyoruz.
  useEffect(() => {
    if (!kingdomId) return;
    let cancelled = false;
    api.kingdom
      .state(kingdomId)
      .then((state) => {
        if (cancelled) return;
        setStatus(state.llm);
        if (state.llm.provider) setProvider(state.llm.provider);
        if (state.llm.model) setModel(state.llm.model);
      })
      .catch(() => {
        /* ayarlar sayfası krallık olmadan da çalışır */
      });
    return () => {
      cancelled = true;
    };
  }, [kingdomId]);

  const restriction = status?.restriction ?? null;
  const allowedProviders = restriction?.allowedProviders;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setGreeting(null);
    try {
      const res: LlmSettingsResponse = await api.settings.saveLlm({
        provider,
        model: model.trim(),
        apiKey,
        ...(provider === 'openai_compatible' ? { baseUrl: baseUrl.trim() } : {}),
      });
      setStatus(res.status);
      if (res.ok) {
        setApiKey(''); // formda tutmuyoruz
        setGreeting(res.greeting ?? null);
      } else {
        setError(res.error ?? 'Bağlantı doğrulanamadı.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ayarlar kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="top-bar">
        <div>
          <div className="kingdom-name" style={{ fontSize: 22, margin: 0 }}>
            GENERAL'İNİZİN SESİ
          </div>
          <div className="kingdom-sub">KENDİ ANAHTARINIZI GETİRİN</div>
        </div>
        <div className="top-bar-actions">
          {kingdomId && (
            <button className="btn" type="button" onClick={() => navigate({ name: 'game', kingdomId })}>
              Krallığa Dön
            </button>
          )}
          <button className="btn" type="button" onClick={() => navigate({ name: 'channels' })}>
            Channel'lar
          </button>
        </div>
      </div>

      {status && (
        <div className={`alert ${status.silent ? 'alert-critical' : status.configured ? 'alert-info' : 'alert-warning'}`}>
          <strong>Bağlantı Durumu</strong>
          {status.silent
            ? `General sessize düştü${status.lastErrorKind ? ` (${status.lastErrorKind})` : ''}. Anahtarınızı yenileyin.`
            : status.configured
              ? `Bağlı: ${status.provider ? PROVIDER_TR[status.provider] : ''} · ${status.model ?? ''}`
              : 'Henüz bir sağlayıcı tanımlanmadı — General sessiz bekliyor.'}
          {status.lastSuccessAt && <> · Son başarılı çağrı: {timeAgo(status.lastSuccessAt)}</>}
        </div>
      )}

      {restriction && (
        <div className="alert alert-warning">
          <strong>Bu channel'ın LLM kısıtı</strong>
          {allowedProviders?.length ? `Sağlayıcı: ${allowedProviders.map((p) => PROVIDER_TR[p]).join(', ')}. ` : ''}
          {restriction.allowedModels?.length ? `Model: ${restriction.allowedModels.join(', ')}. ` : ''}
          {restriction.minTier ? `En az "${restriction.minTier}" kademe model gerekir.` : ''}
        </div>
      )}

      <form className="panel" onSubmit={onSubmit}>
        <h2 className="panel-title">Sağlayıcı Ayarları</h2>

        <div className="field">
          <label htmlFor="provider">Sağlayıcı</label>
          <select
            id="provider"
            className="select-field"
            value={provider}
            onChange={(e) => setProvider(e.target.value as LlmProvider)}
          >
            {LLM_PROVIDERS.filter((p) => !allowedProviders?.length || allowedProviders.includes(p)).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_TR[p]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          <input
            id="model"
            className="input-field"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="ör. claude-sonnet-4-5"
            required
          />
          {restriction?.allowedModels?.length ? (
            <p className="field-hint">İzin verilenler: {restriction.allowedModels.join(', ')}</p>
          ) : null}
        </div>

        {provider === 'openai_compatible' && (
          <div className="field">
            <label htmlFor="baseUrl">Uç Nokta (base URL)</label>
            <input
              id="baseUrl"
              className="input-field"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://.../v1"
              required
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="apiKey">API Anahtarı</label>
          <input
            id="apiKey"
            className="input-field"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            required
          />
          <p className="field-hint">
            Anahtarınız sunucuda <b>şifrelenerek</b> saklanır, hiçbir günlüğe yazılmaz ve başka bir
            oyuncuya gösterilmez. Yalnızca sizin General'inizin çağrılarında kullanılır. Faturalandırma
            doğrudan sağlayıcınız üzerinden işler.
          </p>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Doğrulanıyor…' : 'Kaydet ve Bağlan'}
          </button>
        </div>
      </form>

      {greeting && (
        <section className="panel">
          <h2 className="panel-title">General'iniz konuşuyor</h2>
          <div className="report">{greeting}</div>
        </section>
      )}
    </div>
  );
}
