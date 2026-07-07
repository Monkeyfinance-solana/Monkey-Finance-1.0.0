// Run with: npx ts-node scripts/create_meteora_pool.ts <TKN_MINT> <BTKN_SEED_AMOUNT> <SOL_SEED_AMOUNT>
// (place this file at pod_vault/scripts/create_meteora_pool.ts)
//
// Requires: npm install @meteora-ag/dynamic-amm-sdk bn.js
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, e.g.:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
//   export ANCHOR_WALLET=~/.config/solana/id.json
//
// Requires your local validator to have Meteora's DAMM v1 AMM + Vault
// programs cloned in (see scripts/print_meteora_clone_cmd.ts) if running
// against localhost -- not needed for devnet/mainnet, since Meteora's
// programs already live there for real (same program ids on every
// cluster). You must already hold bTKN -- wrap some TKN via the front end
// (or wrap_cli.ts) first so this wallet has bTKN to seed the pool with.
//
// This is the Meteora replacement for scripts/create_raydium_pool.ts
// (kept around for rollback -- see also the `raydium-working` git tag).
// Uses Meteora's "customizable permissionless constant product pool" --
// the DAMM v1 variant that needs no pre-existing fee-config account,
// unlike createPermissionlessConstantProductPoolWithConfig. This is a
// ONE-TIME bootstrap step (creates the pool + sets its starting price) --
// regular users don't run this, they'll use the "Add LP" tab once that's
// wired up to deposit into the pool this creates.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import AmmImpl, { PROGRAM_ID as METEORA_AMM_PROGRAM_ID } from "@meteora-ag/dynamic-amm-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT, getMint } from "@solana/spl-token";
import BN from "bn.js";
import { RPC_URL } from "./network";

// Mirrors the exact PDA derivation @meteora-ag/dynamic-amm-sdk uses
// internally (getFirstKey/getSecondKey + ["pool", ...] seeds) -- the SDK
// doesn't export this helper at its top level, and the pool address isn't
// returned directly from createCustomizablePermissionlessConstantProductPool,
// so this recomputes it the same way to print out afterward.
function getFirstKey(a: PublicKey, b: PublicKey): Buffer {
  const [bufA, bufB] = [a.toBuffer(), b.toBuffer()];
  return Buffer.compare(bufA, bufB) === 1 ? bufA : bufB;
}
function getSecondKey(a: PublicKey, b: PublicKey): Buffer {
  const [bufA, bufB] = [a.toBuffer(), b.toBuffer()];
  return Buffer.compare(bufA, bufB) === 1 ? bufB : bufA;
}

async function main() {
  const tknMintArg = process.argv[2];
  const btknAmountArg = process.argv[3] ?? "1000";
  const solAmountArg = process.argv[4] ?? "1";
  if (!tknMintArg) {
    console.error(
      "Usage: npx ts-node scripts/create_meteora_pool.ts <TKN_MINT> [bTKN_seed_amount] [SOL_seed_amount]"
    );
    process.exit(1);
  }
  const tknMint = new PublicKey(tknMintArg);

  // Reuses the same ANCHOR_PROVIDER_URL / ANCHOR_WALLET env vars as every
  // other script here, so the program ID always matches whatever's
  // currently deployed instead of a hardcoded, easily-stale address.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PodVault as Program<PodVault>;
  const authority = provider.wallet as anchor.Wallet;

  const [btknMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("btkn_mint"), tknMint.toBuffer()],
    program.programId
  );
  console.log("bTKN mint:", btknMint.toBase58());

  const connection = new Connection(RPC_URL);

  // bTKN always mirrors TKN's own decimals (see initialize.rs's
  // mint::decimals = tkn_mint.decimals) -- read it from chain instead of
  // assuming 6, since this now runs against arbitrary real tokens too.
  const btknMintInfo = await getMint(connection, btknMint);

  const tokenAMint = btknMint;
  const tokenBMint = NATIVE_MINT;
  const tokenAAmount = new BN(Number(btknAmountArg) * 10 ** btknMintInfo.decimals);
  const tokenBAmount = new BN(Number(solAmountArg) * 10 ** 9); // SOL always 9 decimals

  const tx = await AmmImpl.createCustomizablePermissionlessConstantProductPool(
    connection,
    authority.publicKey,
    tokenAMint,
    tokenBMint,
    tokenAAmount,
    tokenBAmount,
    {
      // tradeFeeNumerator is out of FEE_DENOMINATOR = 100_000 on-chain
      // (NOT 10_000/bps) -- numerator = bps * 10, confirmed both from the
      // mercurial-amm program source (FEE_DENOMINATOR) and the SDK's own
      // `tradeFeeBps.mul(new BN(10))` conversion in createConfig. 1000/100_000
      // = 1% trading fee to LPs (up from Meteora's 250/100_000 = 0.25%
      // default), comfortably under the program's own MAX_FEE_DBPS cap (6%).
      tradeFeeNumerator: 1000,
      activationPoint: null, // trade immediately, no delayed launch
      hasAlphaVault: false,
      activationType: 1, // 1 = timestamp-based (0 = slot-based)
      padding: new Array(90).fill(0),
    }
  );

  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signed = await authority.signTransaction(tx);
  const txId = await connection.sendRawTransaction(signed.serialize());

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const result = await connection.confirmTransaction({ signature: txId, ...latestBlockhash }, "confirmed");
  if (result.value.err) {
    throw new Error(`Transaction ${txId} failed on-chain: ${JSON.stringify(result.value.err)}`);
  }

  console.log("\nPool created. Tx signature:", txId);

  const ammProgramId = new PublicKey(METEORA_AMM_PROGRAM_ID);
  const [poolPubkey] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), getFirstKey(tokenAMint, tokenBMint), getSecondKey(tokenAMint, tokenBMint)],
    ammProgramId
  );
  const [lpMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), poolPubkey.toBuffer()],
    ammProgramId
  );

  console.log("\nPool addresses (grab lpMint for set_lp_mint.ts):");
  console.log("  poolId:", poolPubkey.toBase58());
  console.log("  lpMint:", lpMint.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
