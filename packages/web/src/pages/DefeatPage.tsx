/**
 * Yenilgi ekranı — GDD §12.
 *
 * Başkent düştüğünde oyuncu önce son savaş raporunu görür, sonra iki seçeneği
 * bilinçli olarak seçer. Otomatik yönlendirme yok: seçim yapılmadan hiçbir şey
 * olmaz.
 */

import { useEffect, useState } from 'react';
import type { BattleReportDto } from '@krallik/shared';
import { UNITS } from '@krallik/shared';
import { api } from '../api/client';
import { useRouter } from '../state/router';
import { num, timeAgo } from '../lib/format';

function lossSummary(losses: Record<string, number | undefined>): string {
  const parts = Object.entries(losses)
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .map(([unit, count]) => `${num(count as number)} ${UNITS[unit as keyof typeof UNITS]?.nameTr ?? unit}`);
  return parts.length ? parts.join(' · ') : 'kayıp yok';
}

export function DefeatPage({ kingdomId }: { kingdomId: string }) {
  const { navigate } = useRouter();
  const [report, setReport] = useState<BattleReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'spectate' | 'restart_as_refugee' | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.kingdom
      .reports(kingdomId)
      .then((reports) => {
        if (cancelled) return;
        // Başkentin düştüğü rapor öncelikli; yoksa en yenisi.
        const fall = reports.find((r) => r.capitalFell) ?? reports[0] ?? null;
        setReport(fall);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Rapor alınamadı.'));
    return () => {
      cancelled = true;
    };
  }, [kingdomId]);

  const choose = async (choice: 'spectate' | 'restart_as_refugee') => {
    setBusy(true);
    setError(null);
    try {
      await api.kingdom.defeatChoice(kingdomId, choice);
      setDone(choice);
      if (choice === 'restart_as_refugee') navigate({ name: 'channels' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Seçiminiz iletilemedi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="banner">
        <div className="crest">⚜</div>
        <div className="kingdom-name">BAŞKENT DÜŞTÜ</div>
        <div className="kingdom-sub">SEZON SİZİN İÇİN BURADA BİTİYOR</div>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <section className="panel">
        <h2 className="panel-title">Son Savaş Raporu</h2>
        {!report && <p className="empty-note">Rapor yükleniyor…</p>}
        {report && (
          <div className="report">
            <h3>
              {report.attackerKingdomName} → {report.defenderKingdomName}
            </h3>
            <p>{report.narrative}</p>
            <div className="report-line">
              <span>Saldırı gücü</span>
              <b>{num(report.attackPower)}</b>
            </div>
            <div className="report-line">
              <span>Savunma gücü</span>
              <b>{num(report.defensePower)}</b>
            </div>
            <div className="report-line">
              <span>Saldıran kaybı</span>
              <b>{lossSummary(report.attackerLosses)}</b>
            </div>
            <div className="report-line">
              <span>Savunan kaybı</span>
              <b>{lossSummary(report.defenderLosses)}</b>
            </div>
            <div className="report-line">
              <span>Sur hasarı</span>
              <b>
                {num(report.wallDamage)} (kalan {num(report.wallIntegrityAfter)})
              </b>
            </div>
            <div className="report-line">
              <span>Tarih</span>
              <b>{timeAgo(report.createdAt)}</b>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title">Kararınız</h2>
        {done === 'spectate' ? (
          <p className="empty-note">
            İzleyici olarak kaldınız. Diyarı seyredebilir, ama artık buyruk veremezsiniz.
          </p>
        ) : (
          <div className="choice-grid">
            <div className="choice-card">
              <h4>İzleyici kal</h4>
              <p>
                Sezonun sonuna dek diyarı izlersiniz: haritayı, skorları ve bölgesel duyumları
                görürsünüz. Yeni bir krallık kurmazsınız.
              </p>
              <button className="btn" type="button" disabled={busy} onClick={() => void choose('spectate')}>
                İzleyici Kal
              </button>
            </div>
            <div className="choice-card">
              <h4>Mülteci krallığı olarak yeniden başla</h4>
              <p>
                Sağ kalan halkınızla haritanın kenarında küçük bir yerleşim kurarsınız. Unvanlarınız ve
                geçmişiniz kalır; kaynaklarınız sıfırdan başlar.
              </p>
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() => void choose('restart_as_refugee')}
              >
                Yeniden Başla
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
