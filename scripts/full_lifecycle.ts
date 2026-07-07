// Run with: npx ts-node scripts/full_lifecycle.ts
// (place this file at pod_vault/scripts/full_lifecycle.ts)
//
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, e.g.:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
//   export ANCHOR_WALLET=~/.config/solana/id.json
//
// Requires the program to already be deployed to that cluster (anchor build && anchor deploy,
// or just run this right after `anchor test --validator legacy` since that leaves a program
// deployed... actually anchor test tears its validator down, so instead run your own:
//   solana-test-validator --reset
//   anchor deploy
//   npx ts-node scripts/full_lifecycle.ts
//
// This walks through the ENTIRE realistic flow you described, end to end, printing balances
// at every step:
//   1. initialize_vault (TKN mint created fresh here, standing in for a pump.fun launch)
//   2. user wraps TKN -> bTKN
//   3. simulate creating the bTKN/SOL pool elsewhere and getting an LP token back
//      (FAKE -- there's no real AMM running locally, this just mints a stand-in LP token
//      and moves some bTKN into a "pool" account so the LP side of the flow is visible)
//   4. set_lp_mint, pointing the vault at that LP mint
//   5. user stakes their LP tokens
//   6. a second "trader" wraps/unwraps a few times, generating fees that now split
//      between burn and the LP-reward pot (since someone's staked)
//   7. the staker claims their accrued reward
//   8. the staker unstakes everything (auto-claiming any residual first)

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import {
  createMint,
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer as splTransfer,
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
  const trader = Keypair.generate();
  const poolAuthority = Keypair.generate(); // stands in for "the AMM"

  for (const kp of [user, trader, poolAuthority]) {
    const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  console.log("\n=== STEP 0: launch TKN (simulating pump.fun) ===");
  const tknMint = await createMint(provider.connection, authority.payer!, authority.publicKey, null, DECIMALS);
  console.log("TKN mint:", tknMint.toBase58());

  const userTknAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, user.publicKey);
  await mintTo(provider.connection, authority.payer!, tknMint, userTknAccount, authority.publicKey, 100_000 * D);
  const traderTknAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, trader.publicKey);
  await mintTo(provider.connection, authority.payer!, tknMint, traderTknAccount, authority.publicKey, 50_000 * D);
  console.log("Minted 100,000 TKN to user, 50,000 TKN to trader.");

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
  const traderBtknAccount = getAssociatedTokenAddressSync(btknMint, trader.publicKey);

  let lpMint: PublicKey;
  let stakedLpVault: PublicKey;
  let userLpAccount: PublicKey;
  let stakeInfo: PublicKey;

  async function printState(label: string) {
    console.log(`\n---- ${label} ----`);
    const cfg = await program.account.vaultConfig.fetch(vaultConfig).catch(() => null);
    const supply = (await provider.connection.getTokenSupply(tknMint)).value.amount;
    const uTkn = await getAccount(provider.connection, userTknAccount).catch(() => null);
    const uBtkn = await getAccount(provider.connection, userBtknAccount).catch(() => null);
    const vaultTkn = await getAccount(provider.connection, vaultTokenAccount).catch(() => null);
    const rewardPot = await getAccount(provider.connection, rewardVaultTokenAccount).catch(() => null);
    console.log("  TKN total supply:  ", fmt(BigInt(supply)));
    console.log("  user TKN:          ", uTkn ? fmt(uTkn.amount) : "-");
    console.log("  user bTKN:         ", uBtkn ? fmt(uBtkn.amount) : "-");
    console.log("  vault TKN:         ", vaultTkn ? fmt(vaultTkn.amount) : "-");
    console.log("  reward pot (TKN):  ", rewardPot ? fmt(rewardPot.amount) : "-");
    if (lpMint) {
      const uLp = await getAccount(provider.connection, userLpAccount).catch(() => null);
      const staked = await getAccount(provider.connection, stakedLpVault).catch(() => null);
      console.log("  user LP:           ", uLp ? fmt(uLp.amount) : "-");
      console.log("  staked_lp_vault:   ", staked ? fmt(staked.amount) : "-");
    }
    if (cfg) {
      console.log("  total_staked:      ", fmt(cfg.totalStaked));
      console.log("  acc_reward_per_share:", cfg.accRewardPerShare.toString());
    }
    if (stakeInfo) {
      const info = await program.account.stakeInfo.fetch(stakeInfo).catch(() => null);
      console.log("  stake_info.amount: ", info ? fmt(info.amount) : "(not created yet)");
    }
  }

  console.log("\n=== STEP 1: initialize_vault ===");
  // Demo doesn't exercise protocol revenue (0% protocol_bps below), but
  // initialize_vault still requires a valid destination account to exist.
  const protocolTokenAccount = (
    await getOrCreateAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, authority.publicKey)
  ).address;
  await program.methods
    // 0.75% wrap fee, 1.25% unwrap fee, 30% of each fee burned, 0% protocol, 0% to bTKN stakers.
    // Demo TKN mint has no real Metaplex metadata, so bTKN just gets a placeholder here.
    .initializeVault(75, 125, 3000, 0, 0, "Banana Demo Token", "bDEMO", "")
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
  await printState("after initialize_vault");

  console.log("\n=== STEP 2: user wraps 50,000 TKN -> bTKN ===");
  console.log("(nobody's staked yet, so the entire fee gets burned -- expected fallback)");
  await program.methods
    .wrap(new anchor.BN(50_000 * D))
    .accountsPartial({
      user: user.publicKey,
      vaultConfig,
      tknMint,
      btknMint,
      vaultTokenAccount,
      rewardVaultTokenAccount,
      protocolTokenAccount,
      userTknAccount,
      userBtknAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();
  await printState("after user wraps 50,000 TKN");

  console.log("\n=== STEP 3: simulate creating the bTKN/SOL pool elsewhere (FAKE) ===");
  console.log("In reality you'd do this on Raydium/Orca/Meteora's UI or SDK, depositing");
  console.log("bTKN + SOL. Here we just mint a stand-in LP token and move some of the");
  console.log("user's bTKN into a 'pool' account to make the LP side visible.");
  lpMint = await createMint(provider.connection, authority.payer!, authority.publicKey, null, DECIMALS);
  console.log("Fake LP mint:", lpMint.toBase58());

  const poolBtknAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, btknMint, poolAuthority.publicKey);
  const depositAmount = 20_000 * D; // portion of the user's bTKN "deposited" into the fake pool
  await splTransfer(provider.connection, authority.payer!, userBtknAccount, poolBtknAccount, user, depositAmount);

  userLpAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, lpMint, user.publicKey);
  await mintTo(provider.connection, authority.payer!, lpMint, userLpAccount, authority.publicKey, depositAmount); // 1:1, illustrative only
  await printState("after simulated pool deposit (user now holds LP tokens)");

  console.log("\n=== STEP 4: set_lp_mint (point the vault at the LP mint) ===");
  [stakedLpVault] = PublicKey.findProgramAddressSync([Buffer.from("staked_lp"), vaultConfig.toBuffer()], program.programId);
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
  await printState("after set_lp_mint");

  console.log("\n=== STEP 5: user stakes their LP tokens ===");
  [stakeInfo] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), vaultConfig.toBuffer(), user.publicKey.toBuffer()],
    program.programId
  );
  await program.methods
    .stakeLp(new anchor.BN(depositAmount))
    .accountsPartial({
      user: user.publicKey,
      vaultConfig,
      lpMint,
      stakedLpVault,
      rewardVaultTokenAccount,
      userLpTokenAccount: userLpAccount,
      userRewardTokenAccount: userTknAccount,
      stakeInfo,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();
  await printState("after user stakes LP");

  console.log("\n=== STEP 6: trader wraps + unwraps 3 rounds (generates fees, now split burn/reward) ===");
  for (let i = 1; i <= 3; i++) {
    await program.methods
      .wrap(new anchor.BN(5_000 * D))
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

    const traderBtknBal = await getAccount(provider.connection, traderBtknAccount);
    await program.methods
      .unwrap(new anchor.BN(traderBtknBal.amount.toString()))
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
      })
      .signers([trader])
      .rpc();

    await printState(`after trader round-trip #${i}`);
  }

  console.log("\n=== STEP 7: staker claims accrued reward ===");
  await program.methods
    .claimRewards()
    .accountsPartial({
      user: user.publicKey,
      vaultConfig,
      rewardVaultTokenAccount,
      userRewardTokenAccount: userTknAccount,
      stakeInfo,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([user])
    .rpc();
  await printState("after claim_rewards");

  console.log("\n=== STEP 8: staker unstakes everything ===");
  await program.methods
    .unstakeLp(new anchor.BN(depositAmount))
    .accountsPartial({
      user: user.publicKey,
      vaultConfig,
      lpMint,
      stakedLpVault,
      rewardVaultTokenAccount,
      userLpTokenAccount: userLpAccount,
      userRewardTokenAccount: userTknAccount,
      stakeInfo,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([user])
    .rpc();
  await printState("after unstake_lp (final)");

  console.log("\nDone. Full lifecycle complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
