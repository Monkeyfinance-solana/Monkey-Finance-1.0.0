// Run with: npx ts-node scripts/fee_split_demo.ts
// (place this file at pod_vault/scripts/fee_split_demo.ts)
//
// Requires a standing validator (anchor test tears its own down), so:
//   solana-test-validator --reset
//   anchor build && anchor deploy
//   npx ts-node scripts/fee_split_demo.ts
//
// Self-contained, self-verifying demo of the full four-way fee split (burn /
// protocol revenue / bTKN stakers / LP stakers), matching the 20% / 10% /
// 50% / 20% split configured by default in init_vault.ts. Creates its own
// fresh TKN mint and vault (never touches whatever vault you've already got
// running) and prints every participant's balance after every transaction,
// so you can watch the money move step by step.
//
// Participants (TWO stakers in each pool, on purpose, so you can see the
// pro-rata split working across multiple people, not just "sole staker gets
// 100%"):
//   - protocolWallet          -- receives the protocol-revenue share
//                                directly, no staking required.
//   - lpStakerA / lpStakerB   -- stake a mock LP token 60% / 40%, splitting
//                                the LP-staker share in that ratio.
//   - btknStakerA / btknStakerB -- stake bTKN directly, roughly 60% / 40%
//                                (their wrapped amounts start 6,000/4,000
//                                TKN, so the ratio survives the wrap fee).
//   - trader                  -- wraps 200,000 TKN, generating the fee
//                                everyone else's stake earns from.
//
// A note on "dust": the reward accumulator (acc_reward_per_share /
// acc_btkn_reward_per_share) is a MasterChef-style fixed-point accumulator
// scaled by 1e12. Splitting a bucket across multiple stakers of uneven size
// means the accumulator's own internal division can lose a few of the
// smallest possible token units per claim to integer-truncation -- this is
// expected, already-documented behavior (see AUDIT_NOTES.md), not a bug.
// Per-staker claim checks below use a small tolerance for exactly this
// reason; the vault-level checks (burn/protocol/reward-pot totals) don't
// need one, since those come straight from exact integer bps math with no
// accumulator involved.

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
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
const fmt = (n: bigint | number) => (Number(n) / D).toLocaleString(undefined, { maximumFractionDigits: 6 });

// Matches init_vault.ts's defaults -- 20% burn / 10% protocol / 50% bTKN
// stakers / 20% LP stakers (implied remainder), all as a flat % of the fee.
const WRAP_FEE_BPS = 75; // 0.75%
const UNWRAP_FEE_BPS = 125; // 1.25%
const BURN_BPS = 2000;
const PROTOCOL_BPS = 1000;
const BTKN_SHARE_BPS = 5000;

const LP_STAKE_A = 600 * D; // 60% of total LP staked
const LP_STAKE_B = 400 * D; // 40%
const BTKN_BOOTSTRAP_A = 6_000 * D; // wrapped before staking -> ~60% of total bTKN staked
const BTKN_BOOTSTRAP_B = 4_000 * D; // ~40%

// Chosen so amount * WRAP_FEE_BPS / 10_000 and every subsequent split divide
// evenly -- makes the expected numbers easy to eyeball and exact to assert.
const MAIN_WRAP_AMOUNT = 200_000 * D;

// Per-claim tolerance for the reward-accumulator's own fixed-point dust (see
// header comment) -- a handful of the smallest possible token unit, nothing
// close to a meaningful amount of TKN.
const DUST_TOLERANCE = 5;

let failures = 0;
function check(label: string, expected: bigint | number, actual: bigint | number, tolerance = 0) {
  const e = BigInt(Math.trunc(Number(expected)));
  const a = BigInt(Math.trunc(Number(actual)));
  const diff = e > a ? e - a : a - e;
  if (diff <= BigInt(tolerance)) {
    const note = diff === BigInt(0) ? "" : ` (off by ${diff.toString()} raw unit(s), within tolerance)`;
    console.log(`  OK   ${label}: ${fmt(a)}${note}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}: got ${fmt(a)}, expected ${fmt(e)} (diff ${diff.toString()} raw units)`);
  }
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PodVault as Program<PodVault>;
  const authority = provider.wallet as anchor.Wallet;

  const lpStakerA = Keypair.generate();
  const lpStakerB = Keypair.generate();
  const btknStakerA = Keypair.generate();
  const btknStakerB = Keypair.generate();
  const trader = Keypair.generate();
  const protocolWallet = Keypair.generate();

  const people = [lpStakerA, lpStakerB, btknStakerA, btknStakerB, trader];
  for (const kp of people) {
    const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  console.log("=== Setup ===");
  const tknMint = await createMint(provider.connection, authority.payer!, authority.publicKey, null, DECIMALS);
  console.log("TKN mint:", tknMint.toBase58());

  const traderTknAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, trader.publicKey);
  await mintTo(provider.connection, authority.payer!, tknMint, traderTknAccount, authority.publicKey, MAIN_WRAP_AMOUNT);

  // Bootstrap TKN for both bTKN stakers -- wrapped below into bTKN before
  // anyone's staked (so those bootstrap fees just burn, harmlessly). Each
  // account also doubles as that staker's TKN reward-payout account, since
  // rewards are paid in TKN -- same address either way, so it's created
  // exactly once per person (see the header comment on an earlier version
  // of this script hitting "IllegalOwner" by creating it twice).
  const btknStakerATknAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, btknStakerA.publicKey);
  const btknStakerBTknAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, btknStakerB.publicKey);
  await mintTo(provider.connection, authority.payer!, tknMint, btknStakerATknAccount, authority.publicKey, BTKN_BOOTSTRAP_A);
  await mintTo(provider.connection, authority.payer!, tknMint, btknStakerBTknAccount, authority.publicKey, BTKN_BOOTSTRAP_B);
  const btknStakerARewardAccount = btknStakerATknAccount;
  const btknStakerBRewardAccount = btknStakerBTknAccount;

  const [vaultConfig] = PublicKey.findProgramAddressSync([Buffer.from("vault"), tknMint.toBuffer()], program.programId);
  const [btknMint] = PublicKey.findProgramAddressSync([Buffer.from("btkn_mint"), tknMint.toBuffer()], program.programId);
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync([Buffer.from("vault_tkn"), tknMint.toBuffer()], program.programId);
  const [rewardVaultTokenAccount] = PublicKey.findProgramAddressSync([Buffer.from("reward_vault"), tknMint.toBuffer()], program.programId);
  const [stakedBtknVault] = PublicKey.findProgramAddressSync([Buffer.from("staked_btkn"), tknMint.toBuffer()], program.programId);
  const [btknMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), btknMint.toBuffer()],
    METADATA_PROGRAM_ID
  );

  const traderBtknAccount = getAssociatedTokenAddressSync(btknMint, trader.publicKey);
  const btknStakerABtknAccount = getAssociatedTokenAddressSync(btknMint, btknStakerA.publicKey);
  const btknStakerBBtknAccount = getAssociatedTokenAddressSync(btknMint, btknStakerB.publicKey);

  const protocolTokenAccount = (
    await getOrCreateAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, protocolWallet.publicKey)
  ).address;

  async function printBalances(label: string) {
    const cfg = await program.account.vaultConfig.fetch(vaultConfig).catch(() => null);
    const supply = (await provider.connection.getTokenSupply(tknMint)).value.amount;
    const protocolBal = await getAccount(provider.connection, protocolTokenAccount).catch(() => null);
    const potBal = await getAccount(provider.connection, rewardVaultTokenAccount).catch(() => null);
    const aTkn = await getAccount(provider.connection, btknStakerATknAccount).catch(() => null);
    const bTkn = await getAccount(provider.connection, btknStakerBTknAccount).catch(() => null);
    const aBtkn = await getAccount(provider.connection, btknStakerABtknAccount).catch(() => null);
    const bBtkn = await getAccount(provider.connection, btknStakerBBtknAccount).catch(() => null);

    console.log(`\n---- ${label} ----`);
    console.log(`  TKN total supply:        ${fmt(BigInt(supply))}`);
    console.log(`  protocolWallet TKN:      ${protocolBal ? fmt(protocolBal.amount) : "-"}`);
    console.log(`  reward pot TKN:          ${potBal ? fmt(potBal.amount) : "-"}`);
    console.log(`  btknStakerA: TKN ${aTkn ? fmt(aTkn.amount) : "-"} | bTKN ${aBtkn ? fmt(aBtkn.amount) : "-"}`);
    console.log(`  btknStakerB: TKN ${bTkn ? fmt(bTkn.amount) : "-"} | bTKN ${bBtkn ? fmt(bBtkn.amount) : "-"}`);
    if (cfg) {
      console.log(`  total_staked (LP):       ${fmt(cfg.totalStaked)}`);
      console.log(`  total_btkn_staked:       ${fmt(cfg.totalBtknStaked)}`);
    }
  }

  console.log("\n=== initialize_vault (20% burn / 10% protocol / 50% bTKN / 20% LP) ===");
  await program.methods
    // Demo TKN mint has no real Metaplex metadata, so bTKN just gets a placeholder here.
    .initializeVault(WRAP_FEE_BPS, UNWRAP_FEE_BPS, BURN_BPS, PROTOCOL_BPS, BTKN_SHARE_BPS, "Banana Demo Token", "bDEMO", "")
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
  await printBalances("after initialize_vault");

  console.log("\n=== Bootstrap: btknStakerA wraps 6,000 TKN -> bTKN (pre-staking, 100% burns) ===");
  await program.methods
    .wrap(new anchor.BN(BTKN_BOOTSTRAP_A))
    .accountsPartial({
      user: btknStakerA.publicKey,
      vaultConfig,
      tknMint,
      btknMint,
      vaultTokenAccount,
      rewardVaultTokenAccount,
      protocolTokenAccount,
      userTknAccount: btknStakerATknAccount,
      userBtknAccount: btknStakerABtknAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([btknStakerA])
    .rpc();
  await printBalances("after btknStakerA's bootstrap wrap");

  console.log("\n=== Bootstrap: btknStakerB wraps 4,000 TKN -> bTKN (pre-staking, 100% burns) ===");
  await program.methods
    .wrap(new anchor.BN(BTKN_BOOTSTRAP_B))
    .accountsPartial({
      user: btknStakerB.publicKey,
      vaultConfig,
      tknMint,
      btknMint,
      vaultTokenAccount,
      rewardVaultTokenAccount,
      protocolTokenAccount,
      userTknAccount: btknStakerBTknAccount,
      userBtknAccount: btknStakerBBtknAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([btknStakerB])
    .rpc();
  await printBalances("after btknStakerB's bootstrap wrap");

  console.log("\n=== Mock LP mint + set_lp_mint ===");
  const lpMint = await createMint(provider.connection, authority.payer!, authority.publicKey, null, DECIMALS);
  const lpStakerALpAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, lpMint, lpStakerA.publicKey);
  const lpStakerBLpAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, lpMint, lpStakerB.publicKey);
  await mintTo(provider.connection, authority.payer!, lpMint, lpStakerALpAccount, authority.publicKey, LP_STAKE_A);
  await mintTo(provider.connection, authority.payer!, lpMint, lpStakerBLpAccount, authority.publicKey, LP_STAKE_B);
  const lpStakerARewardAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, lpStakerA.publicKey);
  const lpStakerBRewardAccount = await createAssociatedTokenAccount(provider.connection, authority.payer!, tknMint, lpStakerB.publicKey);

  const [stakedLpVault] = PublicKey.findProgramAddressSync([Buffer.from("staked_lp"), vaultConfig.toBuffer()], program.programId);
  await program.methods
    .setLpMint()
    .accountsPartial({ authority: authority.publicKey, vaultConfig, lpMint, stakedLpVault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .rpc();

  console.log("\n=== lpStakerA stakes 600 LP (60%), lpStakerB stakes 400 LP (40%) ===");
  const [stakeInfoA] = PublicKey.findProgramAddressSync([Buffer.from("stake"), vaultConfig.toBuffer(), lpStakerA.publicKey.toBuffer()], program.programId);
  const [stakeInfoB] = PublicKey.findProgramAddressSync([Buffer.from("stake"), vaultConfig.toBuffer(), lpStakerB.publicKey.toBuffer()], program.programId);
  await program.methods
    .stakeLp(new anchor.BN(LP_STAKE_A))
    .accountsPartial({
      user: lpStakerA.publicKey, vaultConfig, lpMint, stakedLpVault, rewardVaultTokenAccount,
      userLpTokenAccount: lpStakerALpAccount, userRewardTokenAccount: lpStakerARewardAccount,
      stakeInfo: stakeInfoA, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([lpStakerA])
    .rpc();
  await program.methods
    .stakeLp(new anchor.BN(LP_STAKE_B))
    .accountsPartial({
      user: lpStakerB.publicKey, vaultConfig, lpMint, stakedLpVault, rewardVaultTokenAccount,
      userLpTokenAccount: lpStakerBLpAccount, userRewardTokenAccount: lpStakerBRewardAccount,
      stakeInfo: stakeInfoB, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([lpStakerB])
    .rpc();
  await printBalances("after both LP stakers stake");

  console.log("\n=== btknStakerA and btknStakerB each stake their full bTKN balance ===");
  const [btknStakeInfoA] = PublicKey.findProgramAddressSync([Buffer.from("btkn_stake"), vaultConfig.toBuffer(), btknStakerA.publicKey.toBuffer()], program.programId);
  const [btknStakeInfoB] = PublicKey.findProgramAddressSync([Buffer.from("btkn_stake"), vaultConfig.toBuffer(), btknStakerB.publicKey.toBuffer()], program.programId);
  const btknBalA = await getAccount(provider.connection, btknStakerABtknAccount);
  const btknBalB = await getAccount(provider.connection, btknStakerBBtknAccount);
  await program.methods
    .stakeBtkn(new anchor.BN(btknBalA.amount.toString()))
    .accountsPartial({
      user: btknStakerA.publicKey, vaultConfig, btknMint, stakedBtknVault, rewardVaultTokenAccount,
      userBtknAccount: btknStakerABtknAccount, userRewardTokenAccount: btknStakerARewardAccount,
      stakeInfo: btknStakeInfoA, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([btknStakerA])
    .rpc();
  await program.methods
    .stakeBtkn(new anchor.BN(btknBalB.amount.toString()))
    .accountsPartial({
      user: btknStakerB.publicKey, vaultConfig, btknMint, stakedBtknVault, rewardVaultTokenAccount,
      userBtknAccount: btknStakerBBtknAccount, userRewardTokenAccount: btknStakerBRewardAccount,
      stakeInfo: btknStakeInfoB, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([btknStakerB])
    .rpc();
  await printBalances("after both bTKN stakers stake");

  console.log(`\nStake ratios going into the main event: LP ${fmt(LP_STAKE_A)}/${fmt(LP_STAKE_B)} (60/40), bTKN ${fmt(btknBalA.amount)}/${fmt(btknBalB.amount)}`);

  console.log("\n=== THE MAIN EVENT: trader wraps 200,000 TKN ===");
  const supplyBefore = BigInt((await provider.connection.getTokenSupply(tknMint)).value.amount);
  const protocolBefore = await getAccount(provider.connection, protocolTokenAccount);
  const rewardPotBefore = await getAccount(provider.connection, rewardVaultTokenAccount);
  const cfgBefore = await program.account.vaultConfig.fetch(vaultConfig);

  await program.methods
    .wrap(new anchor.BN(MAIN_WRAP_AMOUNT))
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
  await printBalances("after trader's 200,000 TKN wrap");

  const supplyAfter = BigInt((await provider.connection.getTokenSupply(tknMint)).value.amount);
  const protocolAfter = await getAccount(provider.connection, protocolTokenAccount);
  const rewardPotAfter = await getAccount(provider.connection, rewardVaultTokenAccount);

  const fee = Math.floor((MAIN_WRAP_AMOUNT * cfgBefore.wrapFeeBps) / 10_000);
  const expectedBurn = Math.floor((fee * BURN_BPS) / 10_000);
  const expectedProtocol = Math.floor((fee * PROTOCOL_BPS) / 10_000);
  const expectedBtkn = Math.floor((fee * BTKN_SHARE_BPS) / 10_000);
  const expectedLp = fee - expectedBurn - expectedProtocol - expectedBtkn;

  console.log(`\nFee generated: ${fmt(fee)} TKN (0.75% of ${fmt(MAIN_WRAP_AMOUNT)})`);
  console.log(`Expected split: burn ${fmt(expectedBurn)} | protocol ${fmt(expectedProtocol)} | bTKN stakers ${fmt(expectedBtkn)} | LP stakers ${fmt(expectedLp)}`);

  console.log("\n=== Verifying vault-level totals (exact -- no accumulator involved) ===");
  check("TKN burned (total supply drop)", expectedBurn, supplyBefore - supplyAfter);
  check("protocol wallet TKN received", expectedProtocol, Number(protocolAfter.amount) - Number(protocolBefore.amount));
  check("reward pot total increase (bTKN + LP shares combined)", expectedBtkn + expectedLp, Number(rewardPotAfter.amount) - Number(rewardPotBefore.amount));

  console.log("\n=== LP stakers claim (60/40 split of the LP-staker bucket) ===");
  const lpABefore = await getAccount(provider.connection, lpStakerARewardAccount);
  await program.methods
    .claimRewards()
    .accountsPartial({ user: lpStakerA.publicKey, vaultConfig, rewardVaultTokenAccount, userRewardTokenAccount: lpStakerARewardAccount, stakeInfo: stakeInfoA, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([lpStakerA])
    .rpc();
  const lpAAfter = await getAccount(provider.connection, lpStakerARewardAccount);
  const lpAClaimed = Number(lpAAfter.amount) - Number(lpABefore.amount);

  const lpBBefore = await getAccount(provider.connection, lpStakerBRewardAccount);
  await program.methods
    .claimRewards()
    .accountsPartial({ user: lpStakerB.publicKey, vaultConfig, rewardVaultTokenAccount, userRewardTokenAccount: lpStakerBRewardAccount, stakeInfo: stakeInfoB, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([lpStakerB])
    .rpc();
  const lpBAfter = await getAccount(provider.connection, lpStakerBRewardAccount);
  const lpBClaimed = Number(lpBAfter.amount) - Number(lpBBefore.amount);
  await printBalances("after both LP stakers claim");

  check("lpStakerA claimed (~60% of LP bucket)", Math.floor((expectedLp * LP_STAKE_A) / (LP_STAKE_A + LP_STAKE_B)), lpAClaimed, DUST_TOLERANCE);
  check("lpStakerB claimed (~40% of LP bucket)", Math.floor((expectedLp * LP_STAKE_B) / (LP_STAKE_A + LP_STAKE_B)), lpBClaimed, DUST_TOLERANCE);
  check("lpStakerA + lpStakerB claimed == full LP bucket", expectedLp, lpAClaimed + lpBClaimed, DUST_TOLERANCE);

  console.log("\n=== bTKN stakers claim (~60/40 split of the bTKN-staker bucket) ===");
  const btknABefore = await getAccount(provider.connection, btknStakerARewardAccount);
  await program.methods
    .claimBtknRewards()
    .accountsPartial({ user: btknStakerA.publicKey, vaultConfig, rewardVaultTokenAccount, userRewardTokenAccount: btknStakerARewardAccount, stakeInfo: btknStakeInfoA, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([btknStakerA])
    .rpc();
  const btknAAfter = await getAccount(provider.connection, btknStakerARewardAccount);
  const btknAClaimed = Number(btknAAfter.amount) - Number(btknABefore.amount);

  const btknBBefore = await getAccount(provider.connection, btknStakerBRewardAccount);
  await program.methods
    .claimBtknRewards()
    .accountsPartial({ user: btknStakerB.publicKey, vaultConfig, rewardVaultTokenAccount, userRewardTokenAccount: btknStakerBRewardAccount, stakeInfo: btknStakeInfoB, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([btknStakerB])
    .rpc();
  const btknBAfter = await getAccount(provider.connection, btknStakerBRewardAccount);
  const btknBClaimed = Number(btknBAfter.amount) - Number(btknBBefore.amount);
  await printBalances("after both bTKN stakers claim");

  const totalBtknStaked = Number(btknBalA.amount) + Number(btknBalB.amount);
  check("btknStakerA claimed (~60% of bTKN bucket)", Math.floor((expectedBtkn * Number(btknBalA.amount)) / totalBtknStaked), btknAClaimed, DUST_TOLERANCE);
  check("btknStakerB claimed (~40% of bTKN bucket)", Math.floor((expectedBtkn * Number(btknBalB.amount)) / totalBtknStaked), btknBClaimed, DUST_TOLERANCE);
  check("btknStakerA + btknStakerB claimed == full bTKN bucket", expectedBtkn, btknAClaimed + btknBClaimed, DUST_TOLERANCE);

  console.log("\n=== Result ===");
  if (failures === 0) {
    console.log("ALL CHECKS PASSED -- every fee bucket landed exactly (or within dust) where the 20/10/50/20 split says it should, correctly pro-rated across multiple stakers in each pool.");
  } else {
    console.log(`${failures} CHECK(S) FAILED -- see FAIL lines above.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
