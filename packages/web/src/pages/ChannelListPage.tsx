/**
 * Channel listesi — GDD §16.3.
 *
 * İki liste: bağlı olunanlar ve katılmaya açık olanlar. Katılım kapalıysa
 * (koruma süresinden kısa kalan channel vb.) neden açıkça yazılır.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ChannelDto, ChannelListResponse, LlmRestriction } from '@krallik/shared';
import { api } from '../api/client';
import { useAuth } from '../state/auth';
import { useRouter } from '../state/router';
import { CHANNEL_TYPE_TR, PROVIDER_TR, duration, num } from '../lib/format';

/**
 * Channel → krallık kimliği eşlemesi.
 *
 * `ChannelDto` krallık kimliğini taşımıyor; katılma yanıtı taşıyor. Bir kez
 * öğrendiğimizde saklıyoruz ki oyuncu sonraki oturumlarda listeden doğrudan
 * krallığına girebilsin. Eşleme yoksa katılma uç noktası yeniden çağrılır —
 * sunucu tarafında zaten var olan krallık için katılma isteği o krallığı
 * döndürür.
 */
const MAP_KEY = 'krallik.kingdomByChannel';

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MAP_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {
    /* yoksay */
  }
}

function restrictionText(restriction: LlmRestriction | null): string {
  if (!restriction) return 'LLM kısıtı yok';
  const parts: string[] = [];
  if (restriction.allowedProviders?.length) {
    parts.push(restriction.allowedProviders.map((p) => PROVIDER_TR[p]).join(', '));
  }
  if (restriction.allowedModels?.length) parts.push(restriction.allowedModels.join(', '));
  if (restriction.minTier) parts.push(`en az ${restriction.minTier} kademe`);
  return parts.length ? `LLM kısıtı: ${parts.join(' · ')}` : 'LLM kısıtı yok';
}

export function ChannelListPage() {
  const { user, logout } = useAuth();
  const { navigate } = useRouter();
  const [data, setData] = useState<ChannelListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<ChannelDto | null>(null);
  const [kingdomName, setKingdomName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.channels
      .list()
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Liste alınamadı.'));
  }, []);

  useEffect(load, [load]);

  const enterKingdom = (channel: ChannelDto) => {
    // Sunucunun verdiği eşleme yetkili kaynaktır; yerel kayıt yalnızca yedek.
    // Eskiden burada katılma ucu çağrılıyordu, ama sunucu zaten krallığı olan
    // bir hesabın ikinci katılma isteğini reddediyor — yeni bir tarayıcıdan
    // giren oyuncu kendi krallığına giremiyordu.
    const map = readMap();
    const kingdomId = data?.kingdomsByChannel?.[channel.id] ?? map[channel.id];
    if (!kingdomId) {
      setError('Bu channel\'daki krallığınız bulunamadı. Sayfayı yenileyip tekrar deneyin.');
      return;
    }
    if (map[channel.id] !== kingdomId) writeMap({ ...map, [channel.id]: kingdomId });
    navigate({ name: 'game', kingdomId });
  };

  const confirmJoin = async () => {
    if (!joining) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.channels.join(joining.id, kingdomName.trim());
      writeMap({ ...readMap(), [joining.id]: res.kingdomId });
      setJoining(null);
      navigate({ name: 'game', kingdomId: res.kingdomId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Katılım başarısız oldu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="top-bar">
        <div>
          <div className="kingdom-name" style={{ fontSize: 22, margin: 0 }}>
            KRALLIK SİMÜLASYONU
          </div>
          <div className="kingdom-sub">{user ? `Hoş geldiniz, ${user.displayName}` : ''}</div>
        </div>
        <div className="top-bar-actions">
          <button className="btn" type="button" onClick={() => navigate({ name: 'settings', kingdomId: null })}>
            Ayarlar
          </button>
          <button className="btn" type="button" onClick={logout}>
            Çıkış
          </button>
        </div>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <section className="panel">
        <h2 className="panel-title">Bağlı olduğunuz channel'lar</h2>
        {!data?.joined.length && <p className="empty-note">Henüz bir channel'a bağlı değilsiniz.</p>}
        {data?.joined.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            actionLabel="Krallığa Gir"
            disabled={busy || channel.status === 'finished'}
            onAction={() => enterKingdom(channel)}
          />
        ))}
      </section>

      <section className="panel">
        <h2 className="panel-title">Katılabileceğiniz açık channel'lar</h2>
        {!data?.open.length && <p className="empty-note">Şu an açık channel yok.</p>}
        {data?.open.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            actionLabel="Katıl"
            disabled={busy || !channel.joinable}
            onAction={() => {
              setJoining(channel);
              setKingdomName('');
            }}
          />
        ))}
      </section>

      {joining && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Channel'a katıl">
          <div className="panel modal">
            <h2 className="panel-title">{joining.name} — Krallığınızı adlandırın</h2>
            <div className="field">
              <label htmlFor="kingdomName">Krallık adı</label>
              <input
                id="kingdomName"
                className="input-field"
                value={kingdomName}
                onChange={(e) => setKingdomName(e.target.value)}
                placeholder="Demirkale"
                maxLength={32}
                autoFocus
              />
              <p className="field-hint">
                Bu ad diyardaki tüm krallıklara görünür; sezon boyunca değişmez.
              </p>
            </div>
            <div className="form-actions">
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy || kingdomName.trim().length < 2}
                onClick={() => void confirmJoin()}
              >
                Tahta Otur
              </button>
              <button className="btn" type="button" onClick={() => setJoining(null)}>
                Vazgeç
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelRow({
  channel,
  actionLabel,
  disabled,
  onAction,
}: {
  channel: ChannelDto;
  actionLabel: string;
  disabled: boolean;
  onAction: () => void;
}) {
  return (
    <div className="channel-row">
      <div className="channel-main">
        <div className="channel-name">{channel.name}</div>
        <div className="channel-meta">
          <span className="pill brass">{CHANNEL_TYPE_TR[channel.channelType]}</span>
          <span className="pill">{channel.durationDays} gün</span>
          {channel.status === 'finished' ? (
            <span className="pill wine">Bitti</span>
          ) : (
            <span className="pill teal">Kalan: {duration(channel.remainingHours * 3600)}</span>
          )}
          <br />
          {restrictionText(channel.llmRestriction)} · Doluluk: {num(channel.kingdomCount)} krallık
        </div>
        {!channel.joinable && channel.joinBlockedReason && (
          <div className="channel-block">{channel.joinBlockedReason}</div>
        )}
      </div>
      <button className="btn" type="button" disabled={disabled} onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}
