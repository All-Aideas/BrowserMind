/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GLIMMER_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
