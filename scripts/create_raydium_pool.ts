// Run with: npx ts-node scripts/create_raydium_pool.ts <TKN_MINT> <BTKN_SEED_AMOUNT> <SOL_SEED_AMOUNT>
// (place this file at pod_vault/scripts/create_raydium_pool.ts)
//
// Requires: npm install @raydium-io/raydium-sdk-v2 bn.js
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, e.g.:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
//   export ANCHOR_WALLET=~/.config/solana/id.json
// For a devnet/mainnet run, also set CLUSTER (see scripts/network.ts), e.g.:
//   export CLUSTER=mainnet
//
// Requires your local validator to have Raydium's CPMM program + config +
// fee accounts cloned in (see the `solana-test-validator --clone...`
// command from earlier) if running against localhost -- not needed for
// devnet/mainnet, since Raydium's program already lives there for real. You
// must already hold bTKN -- wrap some TKN via the front end (or wrap_cli.ts)
// first so this wallet has bTKN to seed the pool with.
//
// This is a ONE-TIME bootstrap step (creates the pool + sets its starting
// price) -- regular users don't run this, they'll use the "Add LP" tab
// once that's wired up to deposit into the pool this creates.
//
// Adapted directly from Raydium's own SDK demo
// (raydium-sdk-V2-demo/src/cpmm/createCpmmPool.ts) -- just swapped in a
// configurable connection, our own bTKN mint (instead of an API-fetched
// token), and native SOL as the other side of the pair.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import {
  Raydium,
  TxVersion,
  DEVNET_PROGRAM_ID,
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
  getCpmmPdaAmmConfigId,
  parseTokenAccountResp,
} from "@raydium-io/raydium-sdk-v2";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getMint } from "@solana/spl-token";
import BN from "bn.js";
import { RPC_URL, CLUSTER } from "./network";

// The SDK doesn't automatically know what's in your wallet -- this mirrors
// Raydium's own demo config's `fetchTokenAccountData` helper so it actually
// sees the bTKN (and SOL) you're about to seed the pool with, instead of
// falsely reporting "you don't has some token account".
async function fetchOwnerTokenAccountData(connection: Connection, owner: PublicKey) {
  const solAccountResp = await connection.getAccountInfo(owner);
  const tokenAccountResp = await connection.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID });
  const token2022Resp = await connection.getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID });
  return parseTokenAccountResp({
    owner,
    solAccountResp,
    tokenAccountResp: {
      context: tokenAccountResp.context,
      value: [...tokenAccountResp.value, ...token2022Resp.value],
    },
  });
}

const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

// Devnet needs Raydium's own DEVNET_PROGRAM_ID constants (their program
// lives at different addresses there); mainnet uses the real, top-level
// exported constants directly.
const cpmmProgramId = CLUSTER === "mainnet" ? CREATE_CPMM_POOL_PROGRAM : DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM;
const cpmmFeeAcc = CLUSTER === "mainnet" ? CREATE_CPMM_POOL_FEE_ACC : DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC;

async function main() {
  const tknMintArg = process.argv[2];
  const btknAmountArg = process.argv[3] ?? "1000";
  const solAmountArg = process.argv[4] ?? "1";
  if (!tknMintArg) {
    console.error(
      "Usage: npx ts-node scripts/create_raydium_pool.ts <TKN_MINT> [bTKN_seed_amount] [SOL_seed_amount]"
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

  const owner = authority.payer!;
  const connection = new Connection(RPC_URL);

  const raydium = await Raydium.load({
    owner,
    connection,
    cluster: CLUSTER,
    disableFeatureCheck: true,
    disableLoadToken: true, // skip Raydium's live token-info API -- we supply mint info directly below
    blockhashCommitment: "finalized",
  });

  raydium.account.updateTokenAccount(await fetchOwnerTokenAccountData(connection, owner.publicKey));

  // bTKN always mirrors TKN's own decimals (see initialize.rs's
  // mint::decimals = tkn_mint.decimals) -- read it from chain instead of
  // assuming 6, since this now runs against arbitrary real tokens too.
  const btknMintInfo = await getMint(connection, btknMint);
  const mintA = { address: btknMint.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), decimals: btknMintInfo.decimals };
  const mintB = { address: NATIVE_SOL_MINT, programId: TOKEN_PROGRAM_ID.toBase58(), decimals: 9 };

  const feeConfigs = await raydium.api.getCpmmConfigs();
  // Only devnet's config PDAs need to be manually recomputed like this --
  // mainnet's configs already come back from the API with correct, real ids.
  if (CLUSTER !== "mainnet") {
    feeConfigs.forEach((config) => {
      config.id = getCpmmPdaAmmConfigId(cpmmProgramId, config.index).publicKey.toBase58();
    });
  }

  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId: cpmmProgramId,
    poolFeeAccount: cpmmFeeAcc,
    mintA,
    mintB,
    mintAAmount: new BN(Number(btknAmountArg) * 10 ** mintA.decimals),
    mintBAmount: new BN(Number(solAmountArg) * 10 ** mintB.decimals),
    startTime: new BN(0),
    feeConfig: feeConfigs[0],
    associatedOnly: false,
    ownerInfo: { useSOLBalance: true },
    txVersion: TxVersion.V0,
  });

  const { txId } = await execute({ sendAndConfirm: true });

  console.log("\nPool created. Tx signature:", txId);
  console.log("\nPool addresses (grab lpMint for set_lp_mint.ts):");
  for (const [key, value] of Object.entries(extInfo.address)) {
    console.log(`  ${key}:`, value.toString());
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
