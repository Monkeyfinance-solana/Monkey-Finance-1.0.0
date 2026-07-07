// Run with: npx ts-node scripts/check_pool_state.ts <TKN_MINT> <POOL_ID> <LP_MINT>
// (place this file at pod_vault/scripts/check_pool_state.ts)
//
// Read-only diagnostic -- prints the Raydium CPMM pool's actual current
// reserves, which mint is really mintA vs mintB (Raydium reorders this by
// pubkey byte comparison at pool creation, independent of what order you
// passed mintA/mintB in), and the LP mint's total supply. Use this after an
// Add LP / Remove LP round-trip to see exactly what state the pool is
// really in, instead of guessing from the front-end.
//
// Needs ANCHOR_PROVIDER_URL (defaults to http://127.0.0.1:8899) and
// optionally CLUSTER=mainnet (see scripts/network.ts).

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Raydium } from "@raydium-io/raydium-sdk-v2";
import { RPC_URL, CLUSTER } from "./network";

async function main() {
  const tknMintArg = process.argv[2];
  const poolIdArg = process.argv[3];
  const lpMintArg = process.argv[4];
  if (!tknMintArg || !poolIdArg || !lpMintArg) {
    console.error("Usage: npx ts-node scripts/check_pool_state.ts <TKN_MINT> <POOL_ID> <LP_MINT>");
    process.exit(1);
  }

  const connection = new Connection(RPC_URL);
  const tknMint = new PublicKey(tknMintArg);

  // Need the program id to derive the bTKN mint PDA -- read it straight
  // from the built IDL like the other scripts do.
  const idl = require("../target/idl/pod_vault.json");
  const programId = new PublicKey(idl.address);
  const [btknMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("btkn_mint"), tknMint.toBuffer()],
    programId
  );
  console.log("bTKN mint:", btknMint.toBase58());

  // Read-only -- this keypair never signs or sends anything.
  const owner = Keypair.generate();
  const raydium = await Raydium.load({
    owner,
    connection,
    cluster: CLUSTER,
    disableFeatureCheck: true,
    disableLoadToken: true,
  });

  const info = await raydium.cpmm.getRpcPoolInfo(poolIdArg, false);

  const btknIsMintA = info.mintA.equals(btknMint);
  const btknIsMintB = info.mintB.equals(btknMint);
  console.log("\nmintA:", info.mintA.toBase58(), `(decimals ${info.mintDecimalA})`);
  console.log("mintB:", info.mintB.toBase58(), `(decimals ${info.mintDecimalB})`);
  console.log(
    btknIsMintA ? "-> bTKN is mintA, SOL is mintB" : btknIsMintB ? "-> bTKN is mintB, SOL is mintA" : "-> NEITHER side matches this vault's bTKN mint!"
  );

  console.log("\nRaw vault balances (before fee deduction):");
  console.log("  vaultA:", info.vaultAAmount.toString());
  console.log("  vaultB:", info.vaultBAmount.toString());
  console.log("Reserves used for pricing (after protocol/fund/creator fees):");
  console.log("  baseReserve (mintA):", info.baseReserve.toString());
  console.log("  quoteReserve (mintB):", info.quoteReserve.toString());

  if (btknIsMintA || btknIsMintB) {
    const btknReserve = btknIsMintA ? info.baseReserve : info.quoteReserve;
    const solReserve = btknIsMintA ? info.quoteReserve : info.baseReserve;
    const btknDecimals = btknIsMintA ? info.mintDecimalA : info.mintDecimalB;
    const solDecimals = btknIsMintA ? info.mintDecimalB : info.mintDecimalA;
    console.log("\nbTKN reserve:", (Number(btknReserve.toString()) / 10 ** btknDecimals).toLocaleString());
    console.log("SOL reserve:", (Number(solReserve.toString()) / 10 ** solDecimals).toLocaleString());
    if (btknReserve.isZero() || solReserve.isZero()) {
      console.log("\n*** Pool has a ZERO reserve on at least one side -- effectively drained. Adds/swaps will fail or misprice until it's reseeded. ***");
    }
  }

  const lpMint = new PublicKey(lpMintArg);
  const supply = await connection.getTokenSupply(lpMint);
  console.log("\nLP mint total supply:", supply.value.uiAmountString, `(raw ${supply.value.amount}, decimals ${supply.value.decimals})`);
  if (supply.value.amount === "0") {
    console.log("*** LP supply is ZERO -- every LP token has been burned/withdrawn. The pool is empty; next Add LP effectively re-seeds it from scratch. ***");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
