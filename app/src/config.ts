export interface VaultDef {
  key: string;
  name: string;
  icon: string;
  // null = not deployed on this validator yet (shown as "coming soon")
  tknMint: string | null;
  status: "live" | "soon";
  // AMM pool address for the bTKN/SOL pair (Meteora DAMM v1 as of the
  // Raydium->Meteora migration -- see scripts/create_meteora_pool.ts).
  // null = no pool yet -> "Add LP" tab stays disabled.
  poolId: string | null;
}

// Add more entries here as more vaults get deployed. The Farm page and the
// protocol-wide dashboard both read from this list automatically.
export const VAULTS: VaultDef[] = [
  {
    key: "tkn",
    name: "TKN / bTKN",
    icon: "\u{1FA99}", // coin
    // Local test vault -- init_vault.ts + update_fees.ts run against a local
    // solana-test-validator. Was on Raydium CPMM (rollback via
    // `git checkout raydium-working`, plus scripts/create_raydium_pool.ts /
    // scripts/print_raydium_clone_cmd.ts and the commented addresses below)
    // -- migrated to Meteora's DAMM v1, the classic constant-product AMM
    // with a plain fungible LP mint (compatible with this vault's
    // stake_lp/unstake_lp instructions as-is, unlike DAMM v2 which uses
    // NFT-based concentrated-liquidity positions instead of a fungible LP
    // token). Needs Meteora's AMM + Vault programs cloned locally first
    // (see scripts/print_meteora_clone_cmd.ts), then a pool created via
    // scripts/create_meteora_pool.ts or the app's Create Pool form. lpMint
    // still needs set_lp_mint.ts before LP staking works.
    tknMint: "5MpU39kmgdq3h6yT6vprKK71ynAUowDct3CpTJPfFmHG",
    status: "live",
    poolId: "FhAZR48YCjV9SPsU7hPYuohfeZC7DF2jDrFLv8DxqnFw",
    // lpMint (Meteora, register via set_lp_mint.ts): 3EquqoDL3rjD9JeXhHyAJe4c2qDXKq1KySN9bEK62p4z

    // --- previous local-test vaults, before validator resets required
    // for the Meteora AMM+Vault+Metaplex clone, and then for the
    // pending_authority/3%-fee-cap account-layout change ---
    // tknMint: "A85z2d2VLVSSqndA91nVdhmrqHVjGu5sZGdQh7ij3Dbt",
    // poolId (Meteora): "EMjYby6covaDUtXAiPSpN2sProHQtzyojYrwU5VpZHUM"
    // lpMint (Meteora, registered via set_lp_mint.ts): DSTN7trEAKRjgrjFyb6X98wAnqjp7Vb6YinN6vC7YTZH
    // tknMint: "CuM5r3w3n3aKZYL9ggSRoFxxLdXtSiq7Tst85RutUMKj",
    // tknMint: "BftLVCz7PKz4KJnF4NfdCDUTKVip3VwXSX1wTRRfMgRw",

    // --- previous Raydium CPMM pool (older tknMint above) ---
    // poolId (Raydium): "6JuwHAJNsxAFh1KhKFtNd1TvSJ43ducsDMLPYD2Y9xtJ"
    // lpMint (Raydium): "HJJh2mbebjNytDuBvs6MzysZDBV7dbreiLS4W558tBHy"

    // --- mainnet dry-run vault (paused, needs redeploy) ---
    // tknMint: "7xKUTpGRzJ6TcYPR2yhaRuUS5XtCSc89a84S591D5Ynq",
    // poolId (Raydium): "GD3f32YtbLhgqEqK5pgLU1rtm1Yju3ob1avjpf718CEq",
    // lpMint (never registered): BteypPxUCpUhC3BojA4DwHWZ1pxfHqTvbcv3bbuu5xix
  },
  {
    key: "sol",
    name: "SOL / pSOL",
    icon: "◎",
    tknMint: null,
    status: "soon",
    poolId: null,
  },
  {
    key: "tbc",
    name: "TBC",
    icon: "❓",
    tknMint: null,
    status: "soon",
    poolId: null,
  },
];
