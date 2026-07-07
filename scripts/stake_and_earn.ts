// Run with: npx ts-node scripts/stake_and_earn.ts
// (place this file at pod_vault/scripts/stake_and_earn.ts)
//
// Requires ANCHOR_PROVIDER_URL and ANCHOR_WALLET env vars set, e.g.:
//   export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
//   export ANCHOR_WALLET=~/.config/solana/id.json
//
// Requires the vault to already be initialized (scripts/init_vault.ts).
//
// This demonstrates the full LP-staking reward loop:
//   1. Creates a plain SPL mint standing in for a real bTKN/SOL LP token
//      (in production this would be the LP mint Raydium/Orca hands you
//      after you create the pool -- this program doesn't care which AMM
//      issued it, it just needs a mint address).
//   2. Calls set_lp_mint once to point the vault at it.
//   3. Stakes some of that "LP token" so there's someone to earn fees.
//   4. Wraps + unwraps TKN, which now splits fees between burn and the
//      LP-reward pot instead of burning 100% (see test_wrap_unwrap.ts for
//      the burn-only fallback behavior when nobody's staked).
//   5. Claims the accrued reward and shows the balance change.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

const DECIMALS = 6;
const WRAP_AMOUNT = 5_000 * 10 ** DECIMALS; // 5,000 TKN, big enough to generate a visible fee

function fmt(rawAmount: bigint | number): string {
  return (Number(rawAmount) / 10 ** DECIMALS).toLocaleString();
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PodVault as Program<PodVault>;
  const authority = provider.wallet as anchor.Wallet;

  const tknMint = new PublicKey("Cwzq2X7ra1S8ryjQGdPeuJ74HMxDtAnpWfvAbw2JVoct");

  const [vaultConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tknMint.toBuffer()],
    program.programId
  );
  const [btknMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("btkn_mint"), tknMint.toBuffer()],
    program.programId
  );
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_tkn"), tknMint.toBuffer()],
    program.programId
  );
  const [rewardVaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault"), tknMint.toBuffer()],
    program.programId
  );
  const [stakeInfo] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), vaultConfig.toBuffer(), authority.publicKey.toBuffer()],
    program.programId
  );

  let cfg = await program.account.vaultConfig.fetch(vaultConfig);

  // ---- Step 1: mock LP mint (only if the vault hasn't already got one) ----
  let lpMint: PublicKey;
  let stakedLpVault: PublicKey;

  if (cfg.lpMint.equals(PublicKey.default)) {
    console.log("No LP mint set yet -- creating a mock one and calling set_lp_mint...");
    lpMint = await createMint(
      provider.connection,
      authority.payer!,
      authority.publicKey,
      null,
      6
    );

    [stakedLpVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("staked_lp"), vaultConfig.toBuffer()],
      program.programId
    );

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

    console.log("LP mint set:", lpMint.toBase58());
  } else {
    lpMint = cfg.lpMint;
    stakedLpVault = cfg.stakedLpVault;
    console.log("Vault already has an LP mint set:", lpMint.toBase58());
  }

  // ---- Step 2: make sure we hold some of that LP token, then stake it ----
  const userLpAccount = getAssociatedTokenAddressSync(lpMint, authority.publicKey);
  try {
    await getAccount(provider.connection, userLpAccount);
  } catch {
    await createAssociatedTokenAccount(
      provider.connection,
      authority.payer!,
      lpMint,
      authority.publicKey
    );
    await mintTo(
      provider.connection,
      authority.payer!,
      lpMint,
      userLpAccount,
      authority.publicKey,
      1_000 * 10 ** 6
    );
  }

  const userTknAccount = getAssociatedTokenAddressSync(tknMint, authority.publicKey);
  const userBtknAccount = getAssociatedTokenAddressSync(btknMint, authority.publicKey);

  cfg = await program.account.vaultConfig.fetch(vaultConfig);
  if (cfg.totalStaked.toNumber() === 0) {
    console.log("Staking 500 LP tokens...");
    await program.methods
      .stakeLp(new anchor.BN(500 * 10 ** 6))
      .accountsPartial({
        user: authority.publicKey,
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
      .rpc();
  } else {
    console.log(`Already staked (total_staked = ${cfg.totalStaked.toString()}), skipping stake step.`);
  }

  // ---- Step 3: wrap + unwrap to generate a fee that now feeds the reward pot ----
  const rewardBefore = await getAccount(provider.connection, rewardVaultTokenAccount).catch(() => null);
  console.log("\nReward pot before wrap/unwrap:", rewardBefore ? fmt(rewardBefore.amount) : "0");

  console.log(`Wrapping ${fmt(WRAP_AMOUNT)} TKN...`);
  await program.methods
    .wrap(new anchor.BN(WRAP_AMOUNT))
    .accountsPartial({
      user: authority.publicKey,
      vaultConfig,
      tknMint,
      btknMint,
      vaultTokenAccount,
      rewardVaultTokenAccount,
      protocolTokenAccount: cfg.protocolTokenAccount,
      userTknAccount,
      userBtknAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const btknBal = await getAccount(provider.connection, userBtknAccount);
  console.log(`Unwrapping ${fmt(btknBal.amount)} bTKN...`);
  await program.methods
    .unwrap(new anchor.BN(btknBal.amount.toString()))
    .accountsPartial({
      user: authority.publicKey,
      vaultConfig,
      tknMint,
      btknMint,
      vaultTokenAccount,
      rewardVaultTokenAccount,
      protocolTokenAccount: cfg.protocolTokenAccount,
      userTknAccount,
      userBtknAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  const rewardAfter = await getAccount(provider.connection, rewardVaultTokenAccount);
  console.log("Reward pot after wrap/unwrap: ", fmt(rewardAfter.amount));

  // ---- Step 4: claim it ----
  const tknBeforeClaim = await getAccount(provider.connection, userTknAccount);
  console.log("\nClaiming rewards...");
  await program.methods
    .claimRewards()
    .accountsPartial({
      user: authority.publicKey,
      vaultConfig,
      rewardVaultTokenAccount,
      userRewardTokenAccount: userTknAccount,
      stakeInfo,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  const tknAfterClaim = await getAccount(provider.connection, userTknAccount);

  console.log(
    "TKN received from claim:",
    fmt(BigInt(tknAfterClaim.amount) - BigInt(tknBeforeClaim.amount))
  );
  const rewardPotFinal = await getAccount(provider.connection, rewardVaultTokenAccount);
  console.log("Reward pot after claim (should be ~0):", fmt(rewardPotFinal.amount));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
