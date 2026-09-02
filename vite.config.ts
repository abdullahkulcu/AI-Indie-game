import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";

const { r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // D1 kasıtlı olarak yok: env.DB kodda hiç okunmuyor (oyun verisi Postgres'te,
  // bkz. scripts/migrate-d1-to-postgres.ts) ve workerd'in D1'i emüle etmek için
  // yazdığı SQLite dosyası bazı sandbox/dosya sistemlerinde (fcntl/mmap
  // kilitlemesi desteklenmeyince) "disk I/O error: SQLITE_IOERR" ile
  // çöküyordu. Kullanılmayan binding'i kaydetmeyince workerd SQLite'a hiç
  // dokunmuyor.
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      // docker compose'da gece vardiyası sidecar'ı sunucuya "app" servis adıyla
      // ulaşır; Vite bilinmeyen Host başlığını varsayılan olarak reddeder.
      allowedHosts: ["app", "localhost", "127.0.0.1"],
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
