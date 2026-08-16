import { IconSprite } from './components/IconSprite';
import { LoginPage } from './pages/LoginPage';
import { ChannelListPage } from './pages/ChannelListPage';
import { GamePage } from './pages/GamePage';
import { SettingsPage } from './pages/SettingsPage';
import { DefeatPage } from './pages/DefeatPage';
import { useAuth } from './state/auth';
import { useRouter } from './state/router';

export function App() {
  const { user, bootstrapping } = useAuth();

  return (
    <>
      <IconSprite />
      {bootstrapping ? (
        <div className="app center-page">
          <p className="empty-note">Saray kayıtları açılıyor…</p>
        </div>
      ) : !user ? (
        <LoginPage />
      ) : (
        <Screen />
      )}
    </>
  );
}

function Screen() {
  const { route } = useRouter();
  switch (route.name) {
    case 'game':
      return <GamePage kingdomId={route.kingdomId} />;
    case 'settings':
      return <SettingsPage kingdomId={route.kingdomId} />;
    case 'defeat':
      return <DefeatPage kingdomId={route.kingdomId} />;
    case 'login':
    case 'channels':
    default:
      return <ChannelListPage />;
  }
}
