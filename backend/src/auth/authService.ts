import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import {
  createPlayer,
  findPlayerByEmailWithHash,
  findPlayerById,
} from "../repositories/playerRepository.js";
import type { Player } from "../models/types.js";

const SALT_ROUNDS = 12;
const TOKEN_TTL = "7d";

export interface AuthResult {
  player: Player;
  token: string;
}

export class AuthError extends Error {}

export async function register(
  username: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  const existing = await findPlayerByEmailWithHash(email);
  if (existing) {
    throw new AuthError("Bu e-posta ile zaten bir hesap var.");
  }
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const player = await createPlayer(username, email, passwordHash);
  return { player, token: issueToken(player.id) };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const found = await findPlayerByEmailWithHash(email);
  if (!found) {
    throw new AuthError("Gecersiz e-posta veya sifre.");
  }
  const valid = await bcrypt.compare(password, found.passwordHash);
  if (!valid) {
    throw new AuthError("Gecersiz e-posta veya sifre.");
  }
  const { passwordHash: _unused, ...player } = found;
  return { player, token: issueToken(player.id) };
}

export function issueToken(playerId: string): string {
  return jwt.sign({ sub: playerId }, env.jwtSecret, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): string {
  const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
  if (typeof payload.sub !== "string") {
    throw new AuthError("Gecersiz token.");
  }
  return payload.sub;
}

export async function requirePlayer(token: string): Promise<Player> {
  const playerId = verifyToken(token);
  const player = await findPlayerById(playerId);
  if (!player) {
    throw new AuthError("Oyuncu bulunamadi.");
  }
  return player;
}
