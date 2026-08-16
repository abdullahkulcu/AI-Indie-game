/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sunucu kökü. Boş bırakılırsa istekler aynı origin'e gider (Vite dev proxy). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
