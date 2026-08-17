/**
 * D1 (SQLite) → Postgres tek seferlik veri taşıma.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/migrate-d1-to-postgres.ts [sqlite-yolu]
 *
 * Idempotenttir: her satır ON CONFLICT DO NOTHING ile yazılır, tekrar çalıştırmak
 * veri bozmaz. Tablolar yabancı anahtar sırasına göre işlenir.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const D1_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";

/** Metin zaman damgalarını UTC kabul ederek Date'e çevirir; Postgres timestamptz bekler. */
const asDate = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  const parsed = new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};
const asNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const asText = (value: unknown) => (value === null || value === undefined ? null : String(value));

type Column = { name: string; convert: (value: unknown) => unknown };
const t = (name: string): Column => ({ name, convert: asText });
const n = (name: string): Column => ({ name, convert: asNumber });
const d = (name: string): Column => ({ name, convert: asDate });

/** Yabancı anahtar sırası: users → channels → geri kalanı. */
const TABLES: Array<{ table: string; conflict: string; columns: Column[] }> = [
  { table: "users", conflict: "(id)", columns: [t("id"), t("email"), t("display_name"), t("password_hash"), t("role"), t("status"), d("created_at"), d("last_login_at")] },
  { table: "channels", conflict: "(id)", columns: [t("id"), t("name"), t("slug"), t("status"), n("speed"), n("duration_days"), n("max_players"), d("starts_at"), d("ends_at"), t("created_by"), d("created_at")] },
  { table: "sessions", conflict: "(token_hash)", columns: [t("token_hash"), t("user_id"), n("expires_at"), d("created_at")] },
  { table: "channel_members", conflict: "(user_id, channel_id)", columns: [t("user_id"), t("channel_id"), t("status"), d("joined_at")] },
  { table: "game_saves", conflict: "(user_id)", columns: [t("user_id"), t("game_state"), n("revision"), d("updated_at")] },
  { table: "llm_credentials", conflict: "(user_id)", columns: [t("user_id"), t("provider"), t("model"), t("encrypted_key"), t("iv"), t("key_version"), d("created_at"), d("updated_at")] },
  { table: "intel_defenses", conflict: "(user_id)", columns: [t("user_id"), n("level"), n("active_until"), d("updated_at")] },
  { table: "intel_missions", conflict: "(id)", columns: [t("id"), t("channel_id"), t("source_user_id"), t("target_user_id"), t("status"), n("success_chance"), n("detection_chance"), n("completes_at"), t("report"), d("created_at"), d("resolved_at")] },
  { table: "shared_mines", conflict: "(id)", columns: [t("id"), t("channel_id"), t("name"), n("ore_remaining"), n("extracted_ore"), n("last_tick_at"), d("created_at")] },
  { table: "shared_mine_workers", conflict: "(mine_id, user_id)", columns: [t("mine_id"), t("user_id"), n("workers"), d("joined_at")] },
  { table: "standing_orders", conflict: "(user_id)", columns: [t("user_id"), t("channel_id"), t("instruction"), t("autonomy"), t("status"), n("max_actions_per_wake"), n("daily_action_cap"), n("actions_today"), n("day_started_at"), n("last_run_at"), t("last_outcome"), d("created_at")] },
  { table: "pending_decisions", conflict: "(user_id)", columns: [t("user_id"), t("action"), t("reasons"), t("risk_level"), n("expires_at"), d("created_at")] },
];

function findSqlite(explicit?: string) {
  if (explicit) return explicit;
  if (!existsSync(D1_DIR)) throw new Error(`D1 dizini yok: ${D1_DIR}`);
  const file = readdirSync(D1_DIR).find(name => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  if (!file) throw new Error("D1 sqlite dosyası bulunamadı.");
  return join(D1_DIR, file);
}

function readTable(sqlitePath: string, table: string): Array<Record<string, unknown>> {
  try {
    // `-json` sütun adlarını korur; json_object(*) bu sqlite sürümünde boş nesne döndürüyor.
    const raw = execFileSync("sqlite3", ["-json", sqlitePath, `select * from "${table}";`], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).trim();
    if (!raw || raw === "[]") return [];
    return JSON.parse(raw) as Array<Record<string, unknown>>;
  } catch {
    return []; // tablo D1'de hiç oluşmamış olabilir
  }
}

async function main() {
  const sqlitePath = findSqlite(process.argv[2]);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL gerekli.");
  console.log(`kaynak : ${sqlitePath}`);
  console.log(`hedef  : ${url.replace(/:[^:@/]+@/, ":****@")}\n`);

  const pool = new Pool({ connectionString: url });
  let total = 0;
  try {
    for (const { table, conflict, columns } of TABLES) {
      const rows = readTable(sqlitePath, table);
      if (!rows.length) { console.log(`${table.padEnd(22)} 0 satır`); continue; }
      const names = columns.map(column => `"${column.name}"`).join(", ");
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
      let written = 0, skipped = 0;
      for (const row of rows) {
        const values = columns.map(column => column.convert(row[column.name]));
        try {
          const result = await pool.query(`insert into "${table}" (${names}) values (${placeholders}) on conflict ${conflict} do nothing`, values);
          written += result.rowCount ?? 0;
        } catch (error) {
          // SQLite'ta yabancı anahtar zorlaması kapalıydı; silinmiş kullanıcıya bağlı
          // yetim satırlar Postgres'te reddedilir ve taşınmaz. Bu beklenen temizliktir.
          if (error instanceof Error && /foreign key/i.test(error.message)) skipped += 1;
          else throw error;
        }
      }
      total += written;
      const note = skipped ? `, ${skipped} yetim satır atlandı` : "";
      console.log(`${table.padEnd(22)} ${rows.length} satır okundu, ${written} yazıldı${note}`);
    }
    console.log(`\ntoplam ${total} satır taşındı.`);
  } finally {
    await pool.end();
  }
}

main().catch(error => { console.error("taşıma başarısız:", error instanceof Error ? error.message : error); process.exit(1); });
