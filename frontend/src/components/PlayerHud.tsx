import type { Resources } from "../types";

interface PlayerHudProps {
  username: string;
  resources: Resources | null;
  tickNumber: number;
  apiKeyConnected: boolean;
}

export function PlayerHud({ username, resources, tickNumber, apiKeyConnected }: PlayerHudProps) {
  return (
    <div className="player-hud">
      <span className="player-hud__name">{username}</span>
      <span>Altin: {resources?.gold ?? "-"}</span>
      <span>Odun: {resources?.wood ?? "-"}</span>
      <span>Yiyecek: {resources?.food ?? "-"}</span>
      <span>Tick: {tickNumber}</span>
      <span className={apiKeyConnected ? "hud-badge hud-badge--ok" : "hud-badge hud-badge--warn"}>
        {apiKeyConnected ? "API baglandi" : "API baglanmadi"}
      </span>
    </div>
  );
}
