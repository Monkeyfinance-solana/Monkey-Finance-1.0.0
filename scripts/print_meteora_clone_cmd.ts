// Run with: npx ts-node scripts/print_meteora_clone_cmd.ts
// (place this file at pod_vault/scripts/print_meteora_clone_cmd.ts)
//
// Prints the `solana-test-validator --clone...` command needed to get
// Meteora's DAMM v1 (dynamic-amm) programs onto your local validator, so
// createPool/addLiquidity/removeLiquidity actually work locally instead of
// failing with "program not found"-type errors.
//
// Unlike Raydium's CPMM (which needed a devnet-specific program id looked
// up live, see print_raydium_clone_cmd.ts), Meteora's DAMM v1 uses the
// SAME program id on both mainnet and devnet -- so these are simple fixed
// constants, no live lookup needed. Sourced directly from:
//   AMM:      https://github.com/MeteoraAg/dynamic-amm-sdk (ts-client/src/amm/constants.ts)
//   Vault:    https://github.com/MeteoraAg/vault-sdk (ts-client/src/vault/constants.ts)
//   Metadata: same dynamic-amm-sdk repo's ts-client/src/amm/constants.ts (METAPLEX_PROGRAM)
//
// DAMM v1 pools deposit into Meteora's separate Vault program (a yield
// layer that lends idle pool liquidity out) -- that's why a second program
// needs cloning, not just the AMM. Per-token vault instances themselves are
// created permissionlessly on the fly by create_meteora_pool.ts, so you
// don't need to clone any specific vault *accounts*, just the program
// binaries. Pool creation (createCustomizablePermissionlessConstantProductPool)
// also CPIs into the Metaplex Token Metadata program to create the new LP
// mint's on-chain metadata -- without cloning it too, pool creation fails
// with "Unsupported program id" right after the vault-creation step
// succeeds.

const METEORA_AMM_PROGRAM_ID = "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB";
const METEORA_VAULT_PROGRAM_ID = "24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi";
const METAPLEX_TOKEN_METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

const DEVNET_RPC = "https://api.devnet.solana.com";

console.log("Meteora DAMM v1 AMM program:", METEORA_AMM_PROGRAM_ID);
console.log("Meteora Dynamic Vault program:", METEORA_VAULT_PROGRAM_ID);
console.log("Metaplex Token Metadata program:", METAPLEX_TOKEN_METADATA_PROGRAM_ID);

console.log("\nRun this instead of a plain `solana-test-validator` (fresh ledger, since --reset is included):\n");
console.log(
  `solana-test-validator --reset \\\n` +
    `  --url ${DEVNET_RPC} \\\n` +
    `  --clone-upgradeable-program ${METEORA_AMM_PROGRAM_ID} \\\n` +
    `  --clone-upgradeable-program ${METEORA_VAULT_PROGRAM_ID} \\\n` +
    `  --clone-upgradeable-program ${METAPLEX_TOKEN_METADATA_PROGRAM_ID}`
);
