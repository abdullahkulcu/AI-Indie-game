import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Channel } from "../types";

interface ChannelPickerProps {
  token: string;
  onJoined: (channelId: string) => void;
}

/** A fixed lobby list (not auto-scaling) - the player picks one of a
 * handful of channels, each with its own map/players/tick loop. */
export function ChannelPicker({ token, onJoined }: ChannelPickerProps) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getChannels(token).then(setChannels).catch((err) => setError(err.message));
  }, [token]);

  async function handleJoin(channel: Channel) {
    setJoiningId(channel.id);
    setError(null);
    try {
      await api.joinChannel(token, channel.id);
      onJoined(channel.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
      setJoiningId(null);
    }
  }

  return (
    <div className="auth-screen">
      <div className="channel-picker">
        <h1>Bir Kanal Sec</h1>
        <p className="auth-subtitle">
          Her kanalin kendi haritasi, oyunculari ve tick dongusu var. Katildiginda haritada rastgele
          bir bolgede baslarsin.
        </p>
        {error && <p className="form-error">{error}</p>}
        {!channels && <p>Yukleniyor...</p>}
        <ul className="channel-list">
          {channels?.map((channel) => {
            const full = channel.playerCount >= channel.maxPlayers;
            return (
              <li key={channel.id} className="channel-list__item">
                <div>
                  <span className="channel-list__name">{channel.name}</span>
                  <span className="channel-list__count">
                    {channel.playerCount}/{channel.maxPlayers} oyuncu
                  </span>
                </div>
                <button disabled={full || joiningId === channel.id} onClick={() => handleJoin(channel)}>
                  {full ? "Dolu" : joiningId === channel.id ? "Katiliniyor..." : "Katil"}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
