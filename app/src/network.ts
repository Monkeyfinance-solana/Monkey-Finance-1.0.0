// Which Solana cluster the app is currently pointed at, driven by
// VITE_CLUSTER in app/.env (see app/.env.example). This matters specifically
// for the Raydium SDK calls in useVaultData.ts, since "devnet" vs "mainnet"
// selects entirely different Raydium CPMM program addresses. Defaults to
// "devnet" (matching the local-validator setup, which clones Raydium's
// devnet-addressed program) if unset.
export const CLUSTER: "devnet" | "mainnet" = import.meta.env.VITE_CLUSTER === "mainnet" ? "mainnet" : "devnet";
