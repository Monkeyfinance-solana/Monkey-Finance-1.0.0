// Run with: npx ts-node scripts/print_raydium_devnet_accounts.ts
//
// Requires: npm install @raydium-io/raydium-sdk-v2
//
// This doesn't touch devnet at all -- it just imports Raydium's own SDK
// constants and derives the CPMM config PDA the same way their SDK does,
// so we get the *real* addresses instead of guessing. The output is the
// exact set of accounts to feed into `solana-test-validator --clone` so
// Raydium's CPMM program works fully on your local validator.

import { DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId } from "@raydium-io/raydium-sdk-v2";

function main() {
  const cpmmProgramId = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM;
  const feeReceiver = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC;

  console.log("CPMM program ID:      ", cpmmProgramId.toBase58());
  console.log("Pool creation fee acc:", feeReceiver.toBase58());

  // Raydium typically only has index 0 initialized on devnet, but print a
  // couple more in case -- any that don't exist on-chain just won't be
  // worth cloning (the clone command will simply skip/fail gracefully for
  // ones that don't resolve).
  for (let i = 0; i < 3; i++) {
    const { publicKey } = getCpmmPdaAmmConfigId(cpmmProgramId, i);
    console.log(`AMM config index ${i}:   `, publicKey.toBase58());
  }
}

main();
