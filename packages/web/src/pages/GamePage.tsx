/**
 * Oyun ekranı: tam genişlikte dünya sahnesi, üzerinde yüzen arayüz.
 *
 * Sahne veriyle beslenir ama veriden bağımsız yaşar: yoklama sonucu gelmeden
 * de (demo yerleşimle) çizilir, böylece açılışta boş bir dikdörtgen görünmez.
 */

import { KingdomScene } from '../scene/KingdomScene';
import { Sidebar } from '../sidebar/Sidebar';
import { KingdomProvider, useKingdom } from '../state/useKingdom';
import { useRouter } from '../state/router';
import { clockOf } from '../lib/format';

export function GamePage({ kingdomId }: { kingdomId: string }) {
  return (
    <KingdomProvider kingdomId={kingdomId}>
      <GameStage kingdomId={kingdomId} />
    </KingdomProvider>
  );
}

function GameStage({ kingdomId }: { kingdomId: string }) {
  const { kingdom, realm, error, reports } = useKingdom();
  const { navigate } = useRouter();

  // Başkenti düşmüş bir krallık için §12 ekranına açık bir kapı bırakıyoruz;
  // oyuncuyu zorla yönlendirmiyoruz, kararı kendi veriyor.
  const fallen = reports.some((r) => r.capitalFell && r.defenderKingdomId === kingdomId);

  return (
    <div className="app app-wide">
      <h2 className="sr-only">
        Krallık yönetim paneli: ortada krallığın izometrik 3B canlı görünümü (gündüz/gece geçişli,
        uzaklaştıkça komşu krallıkların ortaya çıktığı), sağda sekmeli bir kenar çubuğunda danışma
        meclisi, binalar, hazine defteri, diyar haritası, bölgesel duyumlar, ordu ve diplomasi.
      </h2>

      <KingdomScene kingdom={kingdom} realm={realm}>
        <div className="banner-float">
          <div className="crest">⚜</div>
          <div className="kingdom-name">{(kingdom?.name ?? 'KRALLIK').toLocaleUpperCase('tr-TR')}</div>
          <div className="kingdom-sub">
            {kingdom
              ? `${kingdom.channelName.toLocaleUpperCase('tr-TR')} · ${clockOf(kingdom.serverTime)}`
              : 'BAĞLANIYOR…'}
          </div>
        </div>

        <div className="view-badge">
          {kingdom?.mode === 'passive' ? 'PASİF YÖNETİM' : 'KRALLIK GÖRÜNÜMÜ'}
        </div>

        <div className="stage-nav">
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => navigate({ name: 'settings', kingdomId })}
          >
            Ayarlar
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => navigate({ name: 'channels' })}>
            Channel'lar
          </button>
          {fallen && (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => navigate({ name: 'defeat', kingdomId })}
            >
              Yenilgi Raporu
            </button>
          )}
        </div>

        <Sidebar kingdomId={kingdomId} kingdom={kingdom} realm={realm} />
      </KingdomScene>

      {error && (
        <p className="form-error" role="alert">
          Sunucuyla bağlantı sorunlu: {error}
        </p>
      )}
    </div>
  );
}
