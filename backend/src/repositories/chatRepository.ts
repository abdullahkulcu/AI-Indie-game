import { pool } from "../db/pool.js";
import type { ChatMessage, ChatRole } from "../models/types.js";

interface ChatRow {
  id: string;
  player_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
}

function toMessage(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    playerId: row.player_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

export async function saveChatMessage(
  playerId: string,
  role: ChatRole,
  content: string,
): Promise<ChatMessage> {
  const result = await pool.query<ChatRow>(
    `INSERT INTO chat_messages (player_id, role, content)
     VALUES ($1, $2, $3)
     RETURNING id, player_id, role, content, created_at`,
    [playerId, role, content],
  );
  return toMessage(result.rows[0]);
}

const RECENT_CHAT_LIMIT = 20;

export async function listRecentChat(playerId: string): Promise<ChatMessage[]> {
  const result = await pool.query<ChatRow>(
    `SELECT id, player_id, role, content, created_at FROM chat_messages
     WHERE player_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [playerId, RECENT_CHAT_LIMIT],
  );
  return result.rows.map(toMessage).reverse();
}
