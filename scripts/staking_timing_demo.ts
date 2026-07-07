// Run with: npx ts-node scripts/staking_timing_demo.ts
// (place this file at pod_vault/scripts/staking_timing_demo.ts)
//
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, and the program
// already built + deployed to that cluster (needs a standing validator, not
// `anchor test`'s throwaway one):
//   solana-test-validator --reset
//   anchor build && anchor deploy
//   npx ts-node scripts/staking_timing_demo.ts
//
// Demonstrates that two stakers with the IDENTICAL stake amount end up with
// DIFFERENT rewards purely because of *when* they staked, not how much:
//
//   T0: Alice stakes 500 LP.
//   Fee event #1 (trader wraps 10,000 TKN, 2% fee, 0% burned -> 200 TKN into
//                 the reward pot). Alice is the ONLY staker, so all 200 is hers.
//   T1: Bob stakes 500 LP (now total_staked = 1000, split 50/50 going forward).
//       Bob's reward_debt checkpoint "prices in" fee #1 so he can't retroactively
//       claim any of it.
//   Fee event #2 (same size trade, another 200 TKN into the pot) -> split
//       100/100 between Alice and Bob since stakes are now equal.
//   Fee event #3 (same again) -> another 100/100 split.
//   Both claim back-to-back, no staking activity between their claims, so
//   it's a fair snapshot: same "current" conditions, different history.
//
// Expected result: Alice ends up with 400 TKN claimed (200 + 100 + 100),
// Bob ends up with 200 TKN claimed (100 + 100) -- same stake size, same
// final two fee events, but Alice's head start is worth exactly one fee
// event's worth more.
//
// burn_bps is set to 0 here on purpose, purely to keep the arithmetic clean
// for this demo (100% of each fee goes to the reward pot, nothing burned).

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import {
  createMint,
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
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

  const alice = Keypair.generate();
  const bob = Keypair.generate();
  const trader = Keypair.generate();

  for (const kp of [alice, bob, trader]) {
    const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  console.log("=== Setup ===");
  const tknMint = await createMint(provider.connection, authority.payer!, authority.publicKey, null, DECIMALS);
  console.log("TKN mint:", tknMint.toBase58());

  const traderTknAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, trader.publicKey);
  await mintTo(provider.connection, authority.payer!, tknMint, traderTknAccount, authority.publicKey, 50_000 * D);

  const [vaultConfig] = PublicKey.findProgramAddressSync([Buffer.from("vault"), tknMint.toBuffer()], program.programId);
  const [btknMint] = PublicKey.findProgramAddressSync([Buffer.from("btkn_mint"), tknMint.toBuffer()], program.programId);
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync([Buffer.from("vault_tkn"), tknMint.toBuffer()], program.programId);
  const [rewardVaultTokenAccount] = PublicKey.findProgramAddressSync([Buffer.from("reward_vault"), tknMint.toBuffer()], program.programId);
  const [stakedBtknVault] = PublicKey.findProgramAddressSync([Buffer.from("staked_btkn"), tknMint.toBuffer()], program.programId);
  const [btknMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), btknMint.toBuffer()],
    METADATA_PROGRAM_ID
  );
  const traderBtknAccount = anchor.utils.token.associatedAddress({ mint: btknMint, owner: trader.publicKey });

  // Demo doesn't exercise protocol revenue (0% protocol_bps below), but
  // initialize_vault still requires a valid destination account to exist.
  const protocolTokenAccount = (
    await getOrCreateAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, authority.publicKey)
  ).address;

  await program.methods
    // 2% wrap fee, 2% unwrap fee, 0% burned, 0% protocol, 0% to bTKN stakers -- 100% to LP reward pot.
    // Demo TKN mint has no real Metaplex metadata, so bTKN just gets a placeholder here.
    .initializeVault(200, 200, 0, 0, 0, "Banana Demo Token", "bDEMO", "")
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

  // A plain mock LP mint -- this script is only about staking-timing fairness,
  // not the full pool-creation flow (see full_lifecycle.ts for that part).
  const lpMint = await createMint(provider.connection, authority.payer!, authority.publicKey, null, DECIMALS);
  const aliceLpAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, lpMint, alice.publicKey);
  const bobLpAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, lpMint, bob.publicKey);
  await mintTo(provider.connection, authority.payer!, lpMint, aliceLpAccount, authority.publicKey, 500 * D);
  await mintTo(provider.connection, authority.payer!, lpMint, bobLpAccount, authority.publicKey, 500 * D);

  const aliceRewardAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, alice.publicKey);
  const bobRewardAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, bob.publicKey);

  const [stakedLpVault] = PublicKey.findProgramAddressSync([Buffer.from("staked_lp"), vaultConfig.toBuffer()], program.programId);
  await program.methods
    .setLpMint()
    .accountsPartial({
      authority: authority.publicKey,
      vaultConfig,
      lpMint,
      stakedLpVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const [stakeInfoAlice] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), vaultConfig.toBuffer(), alice.publicKey.toBuffer()],
    program.programId
  );
  const [stakeInfoBob] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), vaultConfig.toBuffer(), bob.publicKey.toBuffer()],
    program.programId
  );

  async function printAcc(label: string) {
    const cfg = await program.account.vaultConfig.fetch(vaultConfig);
    const pot = await getAccount(provider.connection, rewardVaultTokenAccount).catch(() => null);
    console.log(`  [${label}] acc_reward_per_share = ${cfg.accRewardPerShare.toString()}, total_staked = ${fmt(BigInt(cfg.totalStaked.toString()))}, reward pot = ${pot ? fmt(pot.amount) : "0"} TKN`);
  }

  async function doWrap() {
    await program.methods
      .wrap(new anchor.BN(10_000 * D))
      .accountsPartial({
        user: trader.publicKey,
        vaultConfig,
        tknMint,
        btknMint,
        vaultTokenAccount,
        rewardVaultTokenAccount,
        protocolTokenAccount,
        userTknAccount: traderTknAccount,
        userBtknAccount: traderBtknAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([trader])
      .rpc();
  }

  console.log("\n=== T0: Alice stakes 500 LP (sole staker) ===");
  await program.methods
    .stakeLp(new anchor.BN(500 * D))
    .accountsPartial({
      user: alice.publicKey,
      vaultConfig,
      lpMint,
      stakedLpVault,
      rewardVaultTokenAccount,
      userLpTokenAccount: aliceLpAccount,
      userRewardTokenAccount: aliceRewardAccount,
      stakeInfo: stakeInfoAlice,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([alice])
    .rpc();
  await printAcc("after Alice stakes");

  console.log("\n=== Fee event #1: trader wraps 10,000 TKN (2% fee = 200 TKN, all to reward pot) ===");
  await doWrap();
  await printAcc("after fee event #1");

  console.log("\n=== T1: Bob stakes 500 LP (joins after fee #1 already happened) ===");
  await program.methods
    .stakeLp(new anchor.BN(500 * D))
    .accountsPartial({
      user: bob.publicKey,
      vaultConfig,
      lpMint,
      stakedLpVault,
      rewardVaultTokenAccount,
      userLpTokenAccount: bobLpAccount,
      userRewardTokenAccount: bobRewardAccount,
      stakeInfo: stakeInfoBob,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([bob])
    .rpc();
  const bobInfoAfterStake = await program.account.stakeInfo.fetch(stakeInfoBob);
  console.log(`  Bob's reward_debt checkpoint at stake time: ${bobInfoAfterStake.rewardDebt.toString()} (this "prices in" fee #1 so he can't retroactively claim it)`);
  await printAcc("after Bob stakes");

  console.log("\n=== Fee event #2: trader wraps another 10,000 TKN (now split 50/50) ===");
  await doWrap();
  await printAcc("after fee event #2");

  console.log("\n=== Fee event #3: trader wraps another 10,000 TKN (again split 50/50) ===");
  await doWrap();
  await printAcc("after fee event #3");

  console.log("\n=== Both claim back-to-back (no staking activity in between) ===");
  const aliceBefore = await getAccount(provider.connection, aliceRewardAccount);
  await program.methods
    .claimRewards()
    .accountsPartial({
      user: alice.publicKey,
      vaultConfig,
      rewardVaultTokenAccount,
      userRewardTokenAccount: aliceRewardAccount,
      stakeInfo: stakeInfoAlice,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([alice])
    .rpc();
  const aliceAfter = await getAccount(provider.connection, aliceRewardAccount);

  const bobBefore = await getAccount(provider.connection, bobRewardAccount);
  await program.methods
    .claimRewards()
    .accountsPartial({
      user: bob.publicKey,
      vaultConfig,
      rewardVaultTokenAccount,
      userRewardTokenAccount: bobRewardAccount,
      stakeInfo: stakeInfoBob,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([bob])
    .rpc();
  const bobAfter = await getAccount(provider.connection, bobRewardAccount);

  const aliceClaimed = BigInt(aliceAfter.amount) - BigInt(aliceBefore.amount);
  const bobClaimed = BigInt(bobAfter.amount) - BigInt(bobBefore.amount);

  console.log(`\n  Alice claimed: ${fmt(aliceClaimed)} TKN   (expected 400 = fee#1's 200 + half of fee#2's 200 + half of fee#3's 200)`);
  console.log(`  Bob claimed:   ${fmt(bobClaimed)} TKN   (expected 200 = half of fee#2 + half of fee#3)`);
  console.log(`\n  Same stake size (500 LP each), same two shared fee events -- Alice earned`);
  console.log(`  exactly one extra fee event's worth (200 TKN) purely for staking earlier.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
