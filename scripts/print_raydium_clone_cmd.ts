// Run with: npx ts-node scripts/print_raydium_clone_cmd.ts
// (place this file at pod_vault/scripts/print_raydium_clone_cmd.ts)
//
// Prints the exact `solana-test-validator --clone...` command needed to get
// Raydium's devnet CPMM program (+ its fee-config accounts) onto your local
// validator, so createPool/addLiquidity/removeLiquidity actually work
// locally instead of failing with "program not found"-type errors.
//
// Computes the config PDAs live (via getCpmmPdaAmmConfigId + Raydium's own
// API for the list of configs) rather than hardcoding addresses, since those
// are real on-chain values worth getting from the source of truth instead of
// guessing. Needs network access to https://api.devnet.solana.com and
// Raydium's API -- doesn't touch your local validator at all, just computes
// what to tell it to clone.

import { Connection, Keypair } from "@solana/web3.js";
import { Raydium, DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId } from "@raydium-io/raydium-sdk-v2";

const DEVNET_RPC = "https://api.devnet.solana.com";

async function main() {
  const connection = new Connection(DEVNET_RPC);
  // Read-only usage (just fetching config data) -- this keypair never signs
  // or sends anything.
  const owner = Keypair.generate();

  const raydium = await Raydium.load({
    owner,
    connection,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
  });

  const feeConfigs = await raydium.api.getCpmmConfigs();
  const configPdas = feeConfigs.map(
    (c) => getCpmmPdaAmmConfigId(DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM, c.index).publicKey
  );

  const programId = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM.toBase58();
  const feeAcc = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC.toBase58();

  console.log("Raydium devnet CPMM program:", programId);
  console.log("Fee-config PDAs (one per fee tier):", configPdas.map((p) => p.toBase58()));
  console.log("Pool-creation fee account:", feeAcc);

  const cloneFlags = [
    `--clone-upgradeable-program ${programId}`,
    ...configPdas.map((p) => `--clone ${p.toBase58()}`),
    `--clone ${feeAcc}`,
  ].join(" \\\n  ");

  console.log("\nRun this instead of a plain `solana-test-validator` (fresh ledger, since --reset is included):\n");
  console.log(
    `solana-test-validator --reset \\\n  --url ${DEVNET_RPC} \\\n  ${cloneFlags}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
