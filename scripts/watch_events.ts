// Run with: npx ts-node scripts/watch_events.ts
// (place this file at pod_vault/scripts/watch_events.ts)
//
// Requires a standing validator (anchor test tears its own down), so:
//   solana-test-validator --reset
//   anchor build && anchor deploy
//   npx ts-node scripts/watch_events.ts
//
// This demonstrates the TWO ways a dashboard would consume event data:
//
//   1. LIVE subscription (program.addEventListener) -- a websocket log
//      subscription that fires a callback the instant a new event lands.
//      This is what you'd use to update a dashboard in real time while
//      it's open.
//
//   2. HISTORICAL backfill (getSignaturesForAddress + EventParser) -- reads
//      past transactions and decodes whatever events they contain. This is
//      what you'd use the moment someone *opens* the dashboard, before any
//      new live events have happened yet, and it's also how you'd compute
//      something like a trailing-7-day APY (sum RewardPaidEvent amounts
//      over the last 7 days of history, annualize against total_staked).
//
// It runs through a short vault lifecycle (init, wrap, stake, wrap again,
// claim, unstake) with live listeners attached the whole time, then
// independently re-derives the same events from chain history to prove
// both paths agree.

import * as anchor from "@anchor-lang/core";
import { Program, EventParser, BorshCoder } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import {
  createMint,
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";

const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const DECIMALS = 6;
const D = 10 ** DECIMALS;
const fmt = (n: bigint | number) => (Number(n) / D).toLocaleString();

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PodVault as Program<PodVault>;
  const authority = provider.wallet as anchor.Wallet;

  const user = Keypair.generate();
  const staker = Keypair.generate();
  for (const kp of [user, staker]) {
    const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  // ---- STEP 1: attach live listeners for every event type ----
  const seenLive: any[] = [];
  const eventNames = ["wrapEvent", "stakeEvent", "rewardPaidEvent", "unstakeEvent"];
  const listenerIds = eventNames.map((name) =>
    program.addEventListener(name as any, (event, slot) => {
      seenLive.push({ name, event, slot });
      console.log(`[LIVE] ${name} (slot ${slot}):`, stringifyEvent(event));
    })
  );

  function stringifyEvent(event: any) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(event)) {
      out[k] = v && typeof (v as any).toString === "function" ? (v as any).toString() : String(v);
    }
    return out;
  }

  console.log("Live listeners attached. Running through a short vault lifecycle...\n");

  // ---- STEP 2: run a short lifecycle so there's something to observe ----
  const tknMint = await createMint(provider.connection, authority.payer!, authority.publicKey, null, DECIMALS);
  const userTknAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, user.publicKey);
  await mintTo(provider.connection, authority.payer!, tknMint, userTknAccount, authority.publicKey, 200_000 * D);

  const [vaultConfig] = PublicKey.findProgramAddressSync([Buffer.from("vault"), tknMint.toBuffer()], program.programId);
  const [btknMint] = PublicKey.findProgramAddressSync([Buffer.from("btkn_mint"), tknMint.toBuffer()], program.programId);
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync([Buffer.from("vault_tkn"), tknMint.toBuffer()], program.programId);
  const [rewardVaultTokenAccount] = PublicKey.findProgramAddressSync([Buffer.from("reward_vault"), tknMint.toBuffer()], program.programId);
  const [stakedBtknVault] = PublicKey.findProgramAddressSync([Buffer.from("staked_btkn"), tknMint.toBuffer()], program.programId);
  const [btknMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), btknMint.toBuffer()],
    METADATA_PROGRAM_ID
  );
  const userBtknAccount = getAssociatedTokenAddressSync(btknMint, user.publicKey);

  // Demo doesn't exercise protocol revenue (0% protocol_bps below), but
  // initialize_vault still requires a valid destination account to exist.
  const protocolTokenAccount = (
    await getOrCreateAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, authority.publicKey)
  ).address;

  await program.methods
    // 1% fees, 1% of each fee burned, 0% protocol, 0% to bTKN stakers (rest to LP reward pot).
    // Demo TKN mint has no real Metaplex metadata, so bTKN just gets a placeholder here.
    .initializeVault(100, 100, 100, 0, 0, "Banana Demo Token", "bDEMO", "")
    .accountsPartial({
      authority: authority.publicKey,
      tknMint,
      protocolTokenAccount,
      vaultConfig,
      btknMint,
      vaultTokenAccount,
      rewardVaultTokenAccount,
      stakedBtknVault,
      btknMetadata,
      tokenMetadataProgram: METADATA_PROGRAM_ID,
      sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const lpMint = await createMint(provider.connection, authority.payer!, authority.publicKey, null, DECIMALS);
  const stakerLpAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, lpMint, staker.publicKey);
  await mintTo(provider.connection, authority.payer!, lpMint, stakerLpAccount, authority.publicKey, 500 * D);
  const stakerRewardAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, staker.publicKey);

  const [stakedLpVault] = PublicKey.findProgramAddressSync([Buffer.from("staked_lp"), vaultConfig.toBuffer()], program.programId);
  await program.methods
    .setLpMint()
    .accountsPartial({ authority: authority.publicKey, vaultConfig, lpMint, stakedLpVault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .rpc();

  const [stakeInfo] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), vaultConfig.toBuffer(), staker.publicKey.toBuffer()],
    program.programId
  );
  await program.methods
    .stakeLp(new anchor.BN(500 * D))
    .accountsPartial({
      user: staker.publicKey, vaultConfig, lpMint, stakedLpVault, rewardVaultTokenAccount,
      userLpTokenAccount: stakerLpAccount, userRewardTokenAccount: stakerRewardAccount, stakeInfo,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([staker])
    .rpc();

  await program.methods
    .wrap(new anchor.BN(10_000 * D))
    .accountsPartial({
      user: user.publicKey, vaultConfig, tknMint, btknMint, vaultTokenAccount, rewardVaultTokenAccount,
      protocolTokenAccount,
      userTknAccount, userBtknAccount, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();

  await program.methods
    .claimRewards()
    .accountsPartial({ user: staker.publicKey, vaultConfig, rewardVaultTokenAccount, userRewardTokenAccount: stakerRewardAccount, stakeInfo, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([staker])
    .rpc();

  await program.methods
    .unstakeLp(new anchor.BN(500 * D))
    .accountsPartial({
      user: staker.publicKey, vaultConfig, lpMint, stakedLpVault, rewardVaultTokenAccount,
      userLpTokenAccount: stakerLpAccount, userRewardTokenAccount: stakerRewardAccount, stakeInfo,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([staker])
    .rpc();

  // give the websocket subscription a moment to deliver the last few events
  await new Promise((r) => setTimeout(r, 1500));
  for (const id of listenerIds) program.removeEventListener(id);

  console.log(`\nLive listener caught ${seenLive.length} events.\n`);

  // ---- STEP 3: independently re-derive the same events from chain history ----
  console.log("---- Re-deriving events from transaction history (the 'backfill' path) ----");
  // Scoped to THIS vault's vaultConfig PDA, not the program ID -- querying
  // by program ID would sweep in every other vault's history too (e.g. if
  // you launch bTKN2 later, or if this script has been run before on this
  // validator). vaultConfig is an account in every wrap/unwrap/stake/
  // unstake/claim instruction, so scoping to it naturally scopes to just
  // this vault's activity.
  const sigs = await provider.connection.getSignaturesForAddress(
    vaultConfig,
    { limit: 25 },
    "confirmed"
  );
  const parser = new EventParser(program.programId, new BorshCoder(program.idl));

  let historical: any[] = [];
  for (const sigInfo of sigs.reverse()) {
    const tx = await provider.connection.getTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx?.meta?.logMessages) continue;
    for (const event of parser.parseLogs(tx.meta.logMessages)) {
      historical.push({ name: event.name, event: event.data, signature: sigInfo.signature });
    }
  }

  console.log(`Backfill found ${historical.length} events across ${sigs.length} recent transactions.\n`);
  for (const h of historical) {
    console.log(`[HISTORY] ${h.name}:`, stringifyEvent(h.event), `\n  tx: ${h.signature}`);
  }

  // ---- STEP 4: the on-chain running totals a dashboard reads directly (no events needed) ----
  console.log("\n---- Running totals (direct account reads, no indexing needed) ----");
  const cfg = await program.account.vaultConfig.fetch(vaultConfig);
  const vaultBal = await getAccount(provider.connection, vaultTokenAccount);
  console.log("TVL (vault TKN balance):     ", fmt(vaultBal.amount));
  console.log("Total burned (cumulative):   ", fmt(BigInt(cfg.totalBurned.toString())));
  console.log("Total reward pot ever funded:", fmt(BigInt(cfg.totalRewardDistributed.toString())));
  console.log("Total currently staked:      ", fmt(BigInt(cfg.totalStaked.toString())));

  // ---- STEP 5: a toy APY calc using the backfilled RewardPaidEvent history ----
  const rewardEvents = historical.filter((h) => h.name === "rewardPaidEvent");
  const totalRewardsInWindow = rewardEvents.reduce((sum, h) => sum + Number(h.event.amount), 0);
  console.log(
    `\nExample APY input: ${fmt(totalRewardsInWindow)} TKN paid out across ${rewardEvents.length} reward event(s) ` +
      `in this session. A real dashboard would sum RewardPaidEvent amounts over a trailing window (e.g. 7 days, ` +
      `using each event's timestamp field) and annualize against total_staked to get a rate.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
