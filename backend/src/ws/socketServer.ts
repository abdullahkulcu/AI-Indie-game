import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { env } from "../config/env.js";
import { verifyToken } from "../auth/authService.js";
import { runPlayerTurn } from "../game/playerTurnService.js";
import { findPlayerById } from "../repositories/playerRepository.js";
import type { GameStateSnapshot } from "../models/types.js";

declare module "socket.io" {
  interface Socket {
    playerId: string;
  }
}

function channelRoom(channelId: string): string {
  return `channel:${channelId}`;
}

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigin },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Yetkilendirme token'i eksik."));
    try {
      socket.playerId = verifyToken(token);
      next();
    } catch {
      next(new Error("Gecersiz veya suresi dolmus token."));
    }
  });

  io.on("connection", (socket: Socket) => {
    // Every state broadcast is scoped to the player's own channel/room - other
    // channels' ticks and chat replies must never reach this socket.
    findPlayerById(socket.playerId)
      .then((player) => {
        if (player?.channelId) socket.join(channelRoom(player.channelId));
      })
      .catch(() => undefined);

    socket.on("chat:send", async (payload: { message?: string }) => {
      const message = payload?.message?.trim();
      if (!message) {
        socket.emit("chat:error", { error: "Bos mesaj gonderilemez." });
        return;
      }
      try {
        const result = await runPlayerTurn(socket.playerId, message);
        socket.emit("chat:reply", {
          reply: result.reply,
          actions: result.actions,
        });
        io.to(channelRoom(result.snapshot.channelId)).emit("state:update", result.snapshot);
      } catch {
        socket.emit("chat:error", {
          error: "Generaliniz su anda karar veremiyor, tekrar deneyin.",
        });
      }
    });
  });

  return io;
}

export function broadcastTick(io: Server, snapshot: GameStateSnapshot): void {
  io.to(channelRoom(snapshot.channelId)).emit("state:update", snapshot);
}
