// Shared network config for scripts that talk to an RPC/Raydium directly.
//
// init_vault.ts, wrap_cli.ts, and set_lp_mint.ts already get this for free
// via anchor.AnchorProvider.env() (which reads ANCHOR_PROVIDER_URL /
// ANCHOR_WALLET) -- they never need editing to switch networks.
// create_raydium_pool.ts additionally needs to know which *cluster*
// ("devnet" | "mainnet") it's pointed at, since that decides which Raydium
// CPMM program/fee-account addresses are correct.
//
// Usage, e.g. for a mainnet run:
//   export ANCHOR_PROVIDER_URL=https://mainnet.helius-rpc.com/?api-key=...
//   export ANCHOR_WALLET=~/.config/solana/id.json
//   export CLUSTER=mainnet
//
// Defaults to the local-validator setup used throughout this project if
// nothing is set, so existing local-validator workflows keep working
// unchanged.

export const RPC_URL = process.env.RPC_URL || process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";

export const CLUSTER: "devnet" | "mainnet" = process.env.CLUSTER === "mainnet" ? "mainnet" : "devnet";
