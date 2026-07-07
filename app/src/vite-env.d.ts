/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_CLUSTER?: "devnet" | "mainnet";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
