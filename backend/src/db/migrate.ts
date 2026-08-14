import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(): Promise<void> {
  const schema = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schema);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  migrate()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log("[migrate] schema applied");
      return pool.end();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[migrate] failed", err);
      process.exit(1);
    });
}
