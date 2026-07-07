// Run with: npx ts-node scripts/derive_pool_address.ts <BTKN_MINT>
// (place this file at pod_vault/scripts/derive_pool_address.ts)
//
// Recovers a Meteora DAMM v1 pool address you forgot to save. The pool
// address is a deterministic PDA of the two token mints (bTKN + native SOL)
// -- it isn't handed back directly by createCustomizablePermissionlessConstantProductPool,
// which is exactly why useVaultData.ts's createPool() has to recompute it
// the same way afterward (see deriveMeteoraPoolAddress there). This script
// does the identical computation standalone, no wallet/RPC connection
// needed -- it's pure math over the two mint addresses.
//
// Needs the bTKN mint, not the TKN mint -- find it by running init_vault.ts's
// printed output again, or deriving it yourself:
//   PublicKey.findProgramAddressSync([Buffer.from("btkn_mint"), tknMint.toBuffer()], PROGRAM_ID)
// (also printed as "bTKN mint PDA" by init_vault.ts when the vault was created).

import { PublicKey } from "@solana/web3.js";

const METEORA_AMM_PROGRAM_ID = new PublicKey("Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB");
const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");

function getFirstKey(a: PublicKey, b: PublicKey): Buffer {
  const [bufA, bufB] = [a.toBuffer(), b.toBuffer()];
  return Buffer.compare(bufA, bufB) === 1 ? bufA : bufB;
}
function getSecondKey(a: PublicKey, b: PublicKey): Buffer {
  const [bufA, bufB] = [a.toBuffer(), b.toBuffer()];
  return Buffer.compare(bufA, bufB) === 1 ? bufB : bufA;
}

function main() {
  const btknMintArg = process.argv[2];
  if (!btknMintArg) {
    console.error("Usage: npx ts-node scripts/derive_pool_address.ts <BTKN_MINT>");
    process.exit(1);
  }
  const btknMint = new PublicKey(btknMintArg);

  const [poolPubkey] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), getFirstKey(btknMint, NATIVE_MINT), getSecondKey(btknMint, NATIVE_MINT)],
    METEORA_AMM_PROGRAM_ID
  );
  const [lpMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), poolPubkey.toBuffer()],
    METEORA_AMM_PROGRAM_ID
  );

  console.log("Pool address: ", poolPubkey.toBase58());
  console.log("LP mint:      ", lpMint.toBase58());
  console.log("\n(LP mint above should match whatever you already passed to set_lp_mint.ts --");
  console.log(" if it doesn't, double check you passed the bTKN mint, not the TKN mint.)");
}

main();
