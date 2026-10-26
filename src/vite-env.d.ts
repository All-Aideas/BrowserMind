/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GLIMMER_MODEL?: string;
  readonly VITE_META_MODEL?: string;
  readonly VITE_GLIMMER_ENABLED?: string;
  readonly VITE_MODEL_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
