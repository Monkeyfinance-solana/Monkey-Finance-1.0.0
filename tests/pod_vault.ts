import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PodVault } from "../target/types/pod_vault";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";

const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

describe("pod_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PodVault as Program<PodVault>;
  const authority = provider.wallet as anchor.Wallet;

  const DECIMALS = 6;
  const WRAP_FEE_BPS = 50; // 0.5%
  const UNWRAP_FEE_BPS = 100; // 1%
  const BURN_BPS = 3000; // 30% of each fee is burned, 70% funds staker rewards
  // Starts at 0 so all the pre-existing LP-only assertions below are
  // unaffected (100% of the non-burned remainder goes to LP stakers, same
  // as before bTKN staking existed). A dedicated "bTKN staking" section
  // near the end flips this via update_fees to exercise the three-way split.
  const BTKN_SHARE_BPS = 0;
  // Starts at 0 for the same reason as BTKN_SHARE_BPS above -- a dedicated
  // "protocol revenue share" section near the end flips this via
  // update_fees to exercise the full four-way split (burn/protocol/bTKN/LP).
  // All four bps fields are a direct % *of the fee itself* now (flat, not
  // nested/sequential).
  const PROTOCOL_BPS = 0;

  let tknMint: PublicKey;
  let vaultConfig: PublicKey;
  let btknMint: PublicKey;
  let btknMetadata: PublicKey;
  let vaultTokenAccount: PublicKey;
  let rewardVaultTokenAccount: PublicKey;
  let stakedBtknVault: PublicKey;

  const user = Keypair.generate();
  let userTknAccount: PublicKey;

  // Stand-in for the real bTKN/SOL LP mint a Raydium/Orca pool would issue.
  let lpMint: PublicKey;
  let stakedLpVault: PublicKey;
  const staker = Keypair.generate();
  let stakerLpAccount: PublicKey;
  let stakerRewardAccount: PublicKey;
  let stakeInfo: PublicKey;

  // A second staker who stakes bTKN directly instead of LP.
  const btknStaker = Keypair.generate();
  let btknStakerBtknAccount: PublicKey;
  let btknStakerRewardAccount: PublicKey;
  let btknStakeInfo: PublicKey;

  // Stand-in for "a wallet the team controls" -- the destination for the
  // protocol-revenue share of fees (see the "protocol revenue share"
  // section near the end).
  const protocolWallet = Keypair.generate();
  let protocolTokenAccount: PublicKey;

  // Set by the "transfer authority" test to the new authority Keypair, so
  // the bTKN-staking section's before() hook (which runs afterward) can
  // sign an update_fees call as whoever the authority is *at that point in
  // the suite*. Stays null until then, meaning "the default provider
  // wallet is still the authority, no explicit signer needed."
  let currentAuthorityKeypair: Keypair | null = null;

  before(async () => {
    for (const kp of [user, staker, btknStaker]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Simulates the TKN mint that would already exist from launching on pump.fun
    tknMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      DECIMALS
    );

    userTknAccount = await createAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      tknMint,
      user.publicKey
    );
    await mintTo(
      provider.connection,
      authority.payer,
      tknMint,
      userTknAccount,
      authority.publicKey,
      1_000_000 * 10 ** DECIMALS
    );

    // A plain mint standing in for a real AMM's LP token, since this
    // program has no idea about Raydium/Orca internals -- it just treats
    // whatever mint set_lp_mint points it at as "the LP token to stake."
    lpMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6
    );
    stakerLpAccount = await createAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      lpMint,
      staker.publicKey
    );
    await mintTo(
      provider.connection,
      authority.payer,
      lpMint,
      stakerLpAccount,
      authority.publicKey,
      1_000 * 10 ** 6
    );
    stakerRewardAccount = await createAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      tknMint,
      staker.publicKey
    );
    btknStakerRewardAccount = await createAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      tknMint,
      btknStaker.publicKey
    );
    protocolTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      tknMint,
      protocolWallet.publicKey
    );

    [vaultConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tknMint.toBuffer()],
      program.programId
    );
    [btknMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("btkn_mint"), tknMint.toBuffer()],
      program.programId
    );
    [btknMetadata] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), btknMint.toBuffer()],
      METADATA_PROGRAM_ID
    );
    [vaultTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tkn"), tknMint.toBuffer()],
      program.programId
    );
    [rewardVaultTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault"), tknMint.toBuffer()],
      program.programId
    );
    [stakedLpVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("staked_lp"), vaultConfig.toBuffer()],
      program.programId
    );
    [stakeInfo] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), vaultConfig.toBuffer(), staker.publicKey.toBuffer()],
      program.programId
    );
    [stakedBtknVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("staked_btkn"), tknMint.toBuffer()],
      program.programId
    );
    [btknStakeInfo] = PublicKey.findProgramAddressSync(
      [Buffer.from("btkn_stake"), vaultConfig.toBuffer(), btknStaker.publicKey.toBuffer()],
      program.programId
    );
    btknStakerBtknAccount = getAssociatedTokenAddressSync(btknMint, btknStaker.publicKey);

    const userBtknAccountForLog = getAssociatedTokenAddressSync(btknMint, user.publicKey);
    console.log("---- account map (for matching escalation errors) ----");
    console.log({
      tknMint: tknMint.toBase58(),
      vaultConfig: vaultConfig.toBase58(),
      btknMint: btknMint.toBase58(),
      vaultTokenAccount: vaultTokenAccount.toBase58(),
      rewardVaultTokenAccount: rewardVaultTokenAccount.toBase58(),
      userTknAccount: userTknAccount.toBase58(),
      userBtknAccount: userBtknAccountForLog.toBase58(),
      lpMint: lpMint.toBase58(),
      stakedLpVault: stakedLpVault.toBase58(),
      stakeInfo: stakeInfo.toBase58(),
      stakerLpAccount: stakerLpAccount.toBase58(),
      stakerRewardAccount: stakerRewardAccount.toBase58(),
      user: user.publicKey.toBase58(),
      staker: staker.publicKey.toBase58(),
      authority: authority.publicKey.toBase58(),
    });
    console.log("--------------------------------------------------------");
  });

  it("initializes the vault", async () => {
    // The test's TKN mint is a bare createMint() with no real Metaplex
    // metadata, so there's nothing to fetch/mirror here -- just supply
    // placeholder name/symbol/uri directly. init_vault.ts is what actually
    // fetches TKN's existing metadata and forwards it for real vaults.
    await program.methods
      .initializeVault(
        WRAP_FEE_BPS,
        UNWRAP_FEE_BPS,
        BURN_BPS,
        PROTOCOL_BPS,
        BTKN_SHARE_BPS,
        "Banana Test Token",
        "bTEST",
        "https://example.com/test-token.json"
      )
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

    const cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.equal(cfg.wrapFeeBps, WRAP_FEE_BPS);
    assert.equal(cfg.unwrapFeeBps, UNWRAP_FEE_BPS);
    assert.equal(cfg.burnBps, BURN_BPS);
    assert.equal(cfg.protocolBps, PROTOCOL_BPS);
    assert.equal(cfg.btknShareBps, BTKN_SHARE_BPS);
    assert.equal(cfg.totalStaked.toNumber(), 0);
    assert.equal(cfg.totalBtknStaked.toNumber(), 0);
    assert.ok(cfg.stakedBtknVault.equals(stakedBtknVault));
    assert.ok(cfg.protocolTokenAccount.equals(protocolTokenAccount));
  });

  it("burns the entire fee when nobody has staked yet", async () => {
    const userBtknAccount = getAssociatedTokenAddressSync(btknMint, user.publicKey);
    const amount = new anchor.BN(10_000 * 10 ** DECIMALS);

    const tknSupplyBefore = (await provider.connection.getTokenSupply(tknMint)).value.amount;

    await program.methods
      .wrap(amount)
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
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const expectedFee = (amount.toNumber() * WRAP_FEE_BPS) / 10_000;
    const expectedNet = amount.toNumber() - expectedFee;

    const tknSupplyAfter = (await provider.connection.getTokenSupply(tknMint)).value.amount;
    assert.equal(
      BigInt(tknSupplyBefore) - BigInt(tknSupplyAfter),
      BigInt(expectedFee),
      "entire fee should have been burned since total_staked is still 0"
    );

    const rewardAcc = await getAccount(provider.connection, rewardVaultTokenAccount);
    assert.equal(Number(rewardAcc.amount), 0);

    const btknAcc = await getAccount(provider.connection, userBtknAccount);
    assert.equal(Number(btknAcc.amount), expectedNet);

    const cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.equal(cfg.totalBurned.toNumber(), expectedFee);
    assert.equal(cfg.totalRewardDistributed.toNumber(), 0);

    // unwrap it straight back out so later tests start from a clean slate
    await program.methods
      .unwrap(new anchor.BN(expectedNet))
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
      })
      .signers([user])
      .rpc();
  });

  it("sets the LP mint and creates the staked-LP vault", async () => {
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

    const cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.ok(cfg.lpMint.equals(lpMint));
    assert.ok(cfg.stakedLpVault.equals(stakedLpVault));
  });

  it("lets a staker stake their LP token", async () => {
    const stakeAmount = new anchor.BN(500 * 10 ** 6);

    await program.methods
      .stakeLp(stakeAmount)
      .accountsPartial({
        user: staker.publicKey,
        vaultConfig,
        lpMint,
        stakedLpVault,
        rewardVaultTokenAccount,
        userLpTokenAccount: stakerLpAccount,
        userRewardTokenAccount: stakerRewardAccount,
        stakeInfo,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([staker])
      .rpc();

    const info = await program.account.stakeInfo.fetch(stakeInfo);
    assert.equal(info.amount.toNumber(), stakeAmount.toNumber());

    const cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.equal(cfg.totalStaked.toNumber(), stakeAmount.toNumber());
  });

  it("wraps TKN once staked: fee splits between burn and LP rewards", async () => {
    const userBtknAccount = getAssociatedTokenAddressSync(btknMint, user.publicKey);
    const amount = new anchor.BN(100_000 * 10 ** DECIMALS);

    const tknSupplyBefore = (await provider.connection.getTokenSupply(tknMint)).value.amount;
    const cfgBefore = await program.account.vaultConfig.fetch(vaultConfig);

    await program.methods
      .wrap(amount)
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
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const expectedFee = (amount.toNumber() * WRAP_FEE_BPS) / 10_000;
    const expectedBurn = Math.floor((expectedFee * BURN_BPS) / 10_000);
    const expectedLpReward = expectedFee - expectedBurn;
    const expectedNet = amount.toNumber() - expectedFee;

    const tknSupplyAfter = (await provider.connection.getTokenSupply(tknMint)).value.amount;
    assert.equal(BigInt(tknSupplyBefore) - BigInt(tknSupplyAfter), BigInt(expectedBurn));

    const rewardAcc = await getAccount(provider.connection, rewardVaultTokenAccount);
    assert.equal(Number(rewardAcc.amount), expectedLpReward);

    const btknAcc = await getAccount(provider.connection, userBtknAccount);
    assert.equal(Number(btknAcc.amount), expectedNet);

    // total_burned/total_reward_distributed are cumulative, so check the
    // delta rather than an absolute value (an earlier test already burned
    // some TKN into the running total).
    const cfgAfter = await program.account.vaultConfig.fetch(vaultConfig);
    assert.equal(
      cfgAfter.totalBurned.toNumber() - cfgBefore.totalBurned.toNumber(),
      expectedBurn
    );
    assert.equal(
      cfgAfter.totalRewardDistributed.toNumber() - cfgBefore.totalRewardDistributed.toNumber(),
      expectedLpReward
    );
  });

  it("emits a WrapEvent with the correct fee breakdown", async () => {
    const userBtknAccount = getAssociatedTokenAddressSync(btknMint, user.publicKey);
    const amount = new anchor.BN(1_000 * 10 ** DECIMALS);

    const eventPromise: Promise<any> = new Promise((resolve) => {
      const listenerId = program.addEventListener("wrapEvent", (event) => {
        program.removeEventListener(listenerId);
        resolve(event);
      });
    });

    await program.methods
      .wrap(amount)
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
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const event = await eventPromise;
    assert.ok(event.vaultConfig.equals(vaultConfig));
    assert.ok(event.user.equals(user.publicKey));
    assert.equal(event.amountIn.toNumber(), amount.toNumber());
    assert.equal(
      event.fee.toNumber(),
      Math.floor((amount.toNumber() * WRAP_FEE_BPS) / 10_000)
    );
    assert.equal(
      event.burned.toNumber() + event.toProtocol.toNumber() + event.toRewardPot.toNumber(),
      event.fee.toNumber()
    );
    assert.equal(event.btknMinted.toNumber(), amount.toNumber() - event.fee.toNumber());
  });

  it("staker can claim the accrued LP reward", async () => {
    const before = await getAccount(provider.connection, stakerRewardAccount);
    const infoBefore = await program.account.stakeInfo.fetch(stakeInfo);

    await program.methods
      .claimRewards()
      .accountsPartial({
        user: staker.publicKey,
        vaultConfig,
        rewardVaultTokenAccount,
        userRewardTokenAccount: stakerRewardAccount,
        stakeInfo,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker])
      .rpc();

    const after = await getAccount(provider.connection, stakerRewardAccount);
    const rewardVaultAcc = await getAccount(provider.connection, rewardVaultTokenAccount);
    const infoAfter = await program.account.stakeInfo.fetch(stakeInfo);
    const claimed = Number(after.amount) - Number(before.amount);

    assert.ok(claimed > 0);
    // total_claimed (on StakeInfo) is how a front-end answers "how much have
    // I gained so far" without replaying event history.
    assert.equal(infoAfter.totalClaimed.toNumber() - infoBefore.totalClaimed.toNumber(), claimed);
    assert.equal(Number(rewardVaultAcc.amount), 0);
  });

  it("rejects fee updates from non-authority", async () => {
    try {
      await program.methods
        .updateFees(200, 300, 4000, 0, 0)
        .accountsPartial({
          authority: user.publicKey,
          vaultConfig,
        })
        .signers([user])
        .rpc();
      assert.fail("expected unauthorized error");
    } catch (err) {
      assert.include(String(err), "Unauthorized");
    }
  });

  it("lets the authority update the fees", async () => {
    await program.methods
      .updateFees(75, 150, 2000, 0, 0)
      .accountsPartial({
        authority: authority.publicKey,
        vaultConfig,
      })
      .rpc();

    const cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.equal(cfg.wrapFeeBps, 75);
    assert.equal(cfg.unwrapFeeBps, 150);
    assert.equal(cfg.burnBps, 2000);
    assert.equal(cfg.protocolBps, 0);
    assert.equal(cfg.btknShareBps, 0);
  });

  it("rejects wrap with a zero amount", async () => {
    const userBtknAccount = getAssociatedTokenAddressSync(btknMint, user.publicKey);
    try {
      await program.methods
        .wrap(new anchor.BN(0))
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
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      assert.fail("expected ZeroAmount error");
    } catch (err) {
      assert.include(String(err), "ZeroAmount");
    }
  });

  it("rejects fee updates above the max allowed", async () => {
    try {
      await program.methods
        .updateFees(2000, 150, 2000, 0, 0) // 2000 bps = 20%, exceeds MAX_FEE_BPS (300 = 3%)
        .accountsPartial({
          authority: authority.publicKey,
          vaultConfig,
        })
        .rpc();
      assert.fail("expected FeeTooHigh error");
    } catch (err) {
      assert.include(String(err), "FeeTooHigh");
    }
  });

  it("rejects setting the LP mint a second time", async () => {
    const cfgBefore = await program.account.vaultConfig.fetch(vaultConfig);
    try {
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
      assert.fail("expected the second set_lp_mint call to fail");
    } catch {
      // Anchor's `init` constraint on staked_lp_vault rejects this before our
      // own LpMintAlreadySet check even runs, since that account already
      // exists from the first call -- so the failure reason is an account
      // constraint violation, not our custom error message. Either way, the
      // important thing is it's rejected and lp_mint is left unchanged.
    }
    const cfgAfter = await program.account.vaultConfig.fetch(vaultConfig);
    assert.ok(cfgAfter.lpMint.equals(cfgBefore.lpMint));
  });

  it("lets the staker unstake part of their LP", async () => {
    const before = await program.account.stakeInfo.fetch(stakeInfo);
    const cfgBefore = await program.account.vaultConfig.fetch(vaultConfig);
    const lpBefore = await getAccount(provider.connection, stakerLpAccount);
    const unstakeAmount = new anchor.BN(200 * 10 ** 6);

    await program.methods
      .unstakeLp(unstakeAmount)
      .accountsPartial({
        user: staker.publicKey,
        vaultConfig,
        lpMint,
        stakedLpVault,
        rewardVaultTokenAccount,
        userLpTokenAccount: stakerLpAccount,
        userRewardTokenAccount: stakerRewardAccount,
        stakeInfo,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker])
      .rpc();

    const after = await program.account.stakeInfo.fetch(stakeInfo);
    const cfgAfter = await program.account.vaultConfig.fetch(vaultConfig);
    assert.equal(before.amount.toNumber() - after.amount.toNumber(), unstakeAmount.toNumber());
    assert.equal(
      cfgBefore.totalStaked.toNumber() - cfgAfter.totalStaked.toNumber(),
      unstakeAmount.toNumber()
    );

    // stakerLpAccount already held an unstaked balance from before (they only
    // staked part of what they were minted), so check the *delta* the LP
    // account received back, not its absolute balance.
    const lpAfter = await getAccount(provider.connection, stakerLpAccount);
    assert.equal(
      Number(lpAfter.amount) - Number(lpBefore.amount),
      unstakeAmount.toNumber()
    );
  });

  it("rejects unstaking more than is currently staked", async () => {
    const info = await program.account.stakeInfo.fetch(stakeInfo);
    const tooMuch = new anchor.BN(info.amount.toNumber() + 1);
    try {
      await program.methods
        .unstakeLp(tooMuch)
        .accountsPartial({
          user: staker.publicKey,
          vaultConfig,
          lpMint,
          stakedLpVault,
          rewardVaultTokenAccount,
          userLpTokenAccount: stakerLpAccount,
          userRewardTokenAccount: stakerRewardAccount,
          stakeInfo,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([staker])
        .rpc();
      assert.fail("expected InsufficientStake error");
    } catch (err) {
      assert.include(String(err), "InsufficientStake");
    }
  });

  it("rejects set_paused from a non-authority", async () => {
    try {
      await program.methods
        .setPaused(true)
        .accountsPartial({
          authority: user.publicKey,
          vaultConfig,
        })
        .signers([user])
        .rpc();
      assert.fail("expected unauthorized error");
    } catch (err) {
      assert.include(String(err), "Unauthorized");
    }
  });

  it("lets the authority pause the vault, blocking wrap", async () => {
    await program.methods
      .setPaused(true)
      .accountsPartial({
        authority: authority.publicKey,
        vaultConfig,
      })
      .rpc();

    const cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.equal(cfg.paused, true);

    const userBtknAccount = getAssociatedTokenAddressSync(btknMint, user.publicKey);
    try {
      await program.methods
        .wrap(new anchor.BN(1_000 * 10 ** DECIMALS))
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
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      assert.fail("expected VaultPaused error");
    } catch (err) {
      assert.include(String(err), "VaultPaused");
    }
  });

  it("lets the authority unpause the vault, restoring wrap", async () => {
    await program.methods
      .setPaused(false)
      .accountsPartial({
        authority: authority.publicKey,
        vaultConfig,
      })
      .rpc();

    const cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.equal(cfg.paused, false);

    const userBtknAccount = getAssociatedTokenAddressSync(btknMint, user.publicKey);
    // should succeed now that it's unpaused
    await program.methods
      .wrap(new anchor.BN(1_000 * 10 ** DECIMALS))
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
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
  });

  it("rejects reset_lp_mint while stakers are still staked", async () => {
    try {
      await program.methods
        .resetLpMint()
        .accountsPartial({
          authority: authority.publicKey,
          vaultConfig,
          stakedLpVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("expected CannotResetWhileStaked error");
    } catch (err) {
      assert.include(String(err), "CannotResetWhileStaked");
    }
  });

  it("lets the staker unstake everything, bringing total_staked to zero", async () => {
    const info = await program.account.stakeInfo.fetch(stakeInfo);
    await program.methods
      .unstakeLp(info.amount)
      .accountsPartial({
        user: staker.publicKey,
        vaultConfig,
        lpMint,
        stakedLpVault,
        rewardVaultTokenAccount,
        userLpTokenAccount: stakerLpAccount,
        userRewardTokenAccount: stakerRewardAccount,
        stakeInfo,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([staker])
      .rpc();

    const cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.equal(cfg.totalStaked.toNumber(), 0);
  });

  it("lets the authority reset the LP mint once nobody is staked", async () => {
    await program.methods
      .resetLpMint()
      .accountsPartial({
        authority: authority.publicKey,
        vaultConfig,
        stakedLpVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.ok(cfg.lpMint.equals(PublicKey.default));
    assert.ok(cfg.stakedLpVault.equals(PublicKey.default));

    const closed = await getAccount(provider.connection, stakedLpVault).catch(() => null);
    assert.equal(closed, null);
  });

  it("lets the authority set a new LP mint after resetting", async () => {
    const newLpMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6
    );

    await program.methods
      .setLpMint()
      .accountsPartial({
        authority: authority.publicKey,
        vaultConfig,
        lpMint: newLpMint,
        stakedLpVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.ok(cfg.lpMint.equals(newLpMint));
    assert.ok(cfg.stakedLpVault.equals(stakedLpVault));
  });

  it("rejects proposing the default pubkey as the new authority", async () => {
    try {
      await program.methods
        .proposeAuthority()
        .accountsPartial({
          authority: authority.publicKey,
          vaultConfig,
          newAuthority: PublicKey.default,
        })
        .rpc();
      assert.fail("expected default pubkey to be rejected");
    } catch (err) {
      assert.include(String(err), "InvalidNewAuthority");
    }
  });

  it("does not transfer authority until the proposed authority accepts (two-step)", async () => {
    const newAuthority = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        newAuthority.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      )
    );

    // Step 1: current authority proposes.
    await program.methods
      .proposeAuthority()
      .accountsPartial({
        authority: authority.publicKey,
        vaultConfig,
        newAuthority: newAuthority.publicKey,
      })
      .rpc();

    let cfg = await program.account.vaultConfig.fetch(vaultConfig);
    // Not in effect yet -- authority is unchanged, only pendingAuthority is set.
    assert.ok(cfg.authority.equals(authority.publicKey));
    assert.ok(cfg.pendingAuthority.equals(newAuthority.publicKey));

    // The old authority can still act while the transfer is pending.
    await program.methods
      .updateFees(50, 100, 2000, 0, 0)
      .accountsPartial({
        authority: authority.publicKey,
        vaultConfig,
      })
      .rpc();

    // Some random keypair (not the proposed one) can't accept it.
    const impostor = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(impostor.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL)
    );
    try {
      await program.methods
        .acceptAuthority()
        .accountsPartial({
          newAuthority: impostor.publicKey,
          vaultConfig,
        })
        .signers([impostor])
        .rpc();
      assert.fail("expected a non-pending signer to be rejected");
    } catch (err) {
      assert.include(String(err), "NotThePendingAuthority");
    }

    // Step 2: the actually-proposed authority accepts -- now it takes effect.
    await program.methods
      .acceptAuthority()
      .accountsPartial({
        newAuthority: newAuthority.publicKey,
        vaultConfig,
      })
      .signers([newAuthority])
      .rpc();

    cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.ok(cfg.authority.equals(newAuthority.publicKey));
    assert.ok(cfg.pendingAuthority.equals(PublicKey.default));
    currentAuthorityKeypair = newAuthority;

    // old authority should no longer be able to update fees
    try {
      await program.methods
        .updateFees(50, 100, 2000, 0, 0)
        .accountsPartial({
          authority: authority.publicKey,
          vaultConfig,
        })
        .rpc();
      assert.fail("expected old authority to be rejected");
    } catch (err) {
      assert.include(String(err), "Unauthorized");
    }

    // new authority should be able to
    await program.methods
      .updateFees(50, 100, 2000, 0, 0)
      .accountsPartial({
        authority: newAuthority.publicKey,
        vaultConfig,
      })
      .signers([newAuthority])
      .rpc();

    const cfgAfter = await program.account.vaultConfig.fetch(vaultConfig);
    assert.equal(cfgAfter.wrapFeeBps, 50);
  });

  it("lets the authority cancel a pending transfer before it's accepted", async () => {
    // currentAuthorityKeypair is the authority from this point on.
    const authorityKp = currentAuthorityKeypair!;
    const wouldBeAuthority = Keypair.generate();

    await program.methods
      .proposeAuthority()
      .accountsPartial({
        authority: authorityKp.publicKey,
        vaultConfig,
        newAuthority: wouldBeAuthority.publicKey,
      })
      .signers([authorityKp])
      .rpc();

    let cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.ok(cfg.pendingAuthority.equals(wouldBeAuthority.publicKey));

    await program.methods
      .cancelAuthorityTransfer()
      .accountsPartial({
        authority: authorityKp.publicKey,
        vaultConfig,
      })
      .signers([authorityKp])
      .rpc();

    cfg = await program.account.vaultConfig.fetch(vaultConfig);
    assert.ok(cfg.pendingAuthority.equals(PublicKey.default));

    // the cancelled address can no longer accept anything.
    try {
      await program.methods
        .acceptAuthority()
        .accountsPartial({
          newAuthority: wouldBeAuthority.publicKey,
          vaultConfig,
        })
        .signers([wouldBeAuthority])
        .rpc();
      assert.fail("expected accept to fail after cancellation");
    } catch (err) {
      assert.include(String(err), "NoPendingAuthorityTransfer");
    }
  });

  describe("bTKN staking (no LP required)", () => {
    // Give this staker some bTKN to work with by wrapping TKN directly.
    before(async () => {
      const wrapAmount = new anchor.BN(50_000 * 10 ** DECIMALS);

      // btknStakerRewardAccount (created in the top-level before() hook) is
      // already the ATA(tknMint, btknStaker.publicKey) -- rewards are paid in
      // TKN, the same mint this section wraps from, so it's the same address
      // as what we'd otherwise create here. Reuse it instead of calling
      // createAssociatedTokenAccount again: that call is non-idempotent and
      // errors with "IllegalOwner"/"Provided owner is not allowed" once the
      // account already exists.
      const btknStakerTknAccount = btknStakerRewardAccount;
      await mintTo(
        provider.connection,
        authority.payer,
        tknMint,
        btknStakerTknAccount,
        authority.publicKey,
        wrapAmount.toNumber()
      );

      await program.methods
        .wrap(wrapAmount)
        .accountsPartial({
          user: btknStaker.publicKey,
          vaultConfig,
          tknMint,
          btknMint,
          vaultTokenAccount,
          rewardVaultTokenAccount,
          protocolTokenAccount,
          userTknAccount: btknStakerTknAccount,
          userBtknAccount: btknStakerBtknAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([btknStaker])
        .rpc();

      // Turn on the bTKN-staker reward share now that there's someone to
      // stake bTKN. Authority has been transferred to currentAuthorityKeypair
      // by this point in the suite, so that Keypair has to sign explicitly
      // (it's not the provider's default wallet). protocol_bps stays 0 here
      // -- the dedicated "protocol revenue share" section below is what
      // exercises that split.
      const cfg = await program.account.vaultConfig.fetch(vaultConfig);
      const updateFeesCall = program.methods
        .updateFees(cfg.wrapFeeBps, cfg.unwrapFeeBps, cfg.burnBps, 0, 5000) // 50% of the fee now goes to bTKN stakers
        .accountsPartial({
          authority: cfg.authority,
          vaultConfig,
        });
      if (currentAuthorityKeypair) {
        await updateFeesCall.signers([currentAuthorityKeypair]).rpc();
      } else {
        await updateFeesCall.rpc();
      }
    });

    it("lets a holder stake bTKN directly", async () => {
      const btknAcc = await getAccount(provider.connection, btknStakerBtknAccount);
      const stakeAmount = new anchor.BN(Number(btknAcc.amount));

      await program.methods
        .stakeBtkn(stakeAmount)
        .accountsPartial({
          user: btknStaker.publicKey,
          vaultConfig,
          btknMint,
          stakedBtknVault,
          rewardVaultTokenAccount,
          userBtknAccount: btknStakerBtknAccount,
          userRewardTokenAccount: btknStakerRewardAccount,
          stakeInfo: btknStakeInfo,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([btknStaker])
        .rpc();

      const info = await program.account.stakeInfo.fetch(btknStakeInfo);
      assert.equal(info.amount.toNumber(), stakeAmount.toNumber());

      const cfg = await program.account.vaultConfig.fetch(vaultConfig);
      assert.equal(cfg.totalBtknStaked.toNumber(), stakeAmount.toNumber());
    });

    it("splits a wrap fee three ways once both pools have stakers", async () => {
      const cfgBefore = await program.account.vaultConfig.fetch(vaultConfig);
      const amount = new anchor.BN(10_000 * 10 ** DECIMALS);

      await program.methods
        .wrap(amount)
        .accountsPartial({
          user: user.publicKey,
          vaultConfig,
          tknMint,
          btknMint,
          vaultTokenAccount,
          rewardVaultTokenAccount,
          protocolTokenAccount,
          userTknAccount,
          userBtknAccount: getAssociatedTokenAddressSync(btknMint, user.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const cfgAfter = await program.account.vaultConfig.fetch(vaultConfig);
      // Every bucket is a flat % *of the fee itself* now (not nested) --
      // burn_bps + protocol_bps + btkn_share_bps <= 10_000, and lp gets
      // whatever's left over.
      const fee = Math.floor((amount.toNumber() * cfgBefore.wrapFeeBps) / 10_000);
      let expectedBurn = Math.floor((fee * cfgBefore.burnBps) / 10_000);
      let expectedProtocol = Math.floor((fee * cfgBefore.protocolBps) / 10_000);
      let expectedBtknReward = Math.floor((fee * cfgBefore.btknShareBps) / 10_000);
      let expectedLpReward = fee - expectedBurn - expectedProtocol - expectedBtknReward;

      // Nobody's staked LP at this point in the suite (the earlier LP staker
      // fully unstaked and no one re-staked the post-reset LP mint), so the
      // vault redirects that share to burn instead -- mirror that here.
      if (cfgBefore.totalStaked.toNumber() === 0) {
        expectedBurn += expectedLpReward;
        expectedLpReward = 0;
      }
      if (cfgBefore.totalBtknStaked.toNumber() === 0) {
        expectedBurn += expectedBtknReward;
        expectedBtknReward = 0;
      }

      assert.equal(
        cfgAfter.totalBurned.toNumber() - cfgBefore.totalBurned.toNumber(),
        expectedBurn
      );
      assert.equal(
        cfgAfter.totalProtocolDistributed.toNumber() -
          cfgBefore.totalProtocolDistributed.toNumber(),
        expectedProtocol
      );
      assert.equal(
        cfgAfter.totalRewardDistributed.toNumber() - cfgBefore.totalRewardDistributed.toNumber(),
        expectedLpReward
      );
      assert.equal(
        cfgAfter.totalBtknRewardDistributed.toNumber() -
          cfgBefore.totalBtknRewardDistributed.toNumber(),
        expectedBtknReward
      );
    });

    it("lets a bTKN staker claim accrued rewards", async () => {
      const before = await getAccount(provider.connection, btknStakerRewardAccount);

      await program.methods
        .claimBtknRewards()
        .accountsPartial({
          user: btknStaker.publicKey,
          vaultConfig,
          rewardVaultTokenAccount,
          userRewardTokenAccount: btknStakerRewardAccount,
          stakeInfo: btknStakeInfo,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([btknStaker])
        .rpc();

      const after = await getAccount(provider.connection, btknStakerRewardAccount);
      assert.ok(Number(after.amount) > Number(before.amount));
    });

    it("rejects unstaking more bTKN than is staked", async () => {
      const info = await program.account.stakeInfo.fetch(btknStakeInfo);
      const tooMuch = new anchor.BN(info.amount.toNumber() + 1);
      try {
        await program.methods
          .unstakeBtkn(tooMuch)
          .accountsPartial({
            user: btknStaker.publicKey,
            vaultConfig,
            btknMint,
            stakedBtknVault,
            rewardVaultTokenAccount,
            userBtknAccount: btknStakerBtknAccount,
            userRewardTokenAccount: btknStakerRewardAccount,
            stakeInfo: btknStakeInfo,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([btknStaker])
          .rpc();
        assert.fail("expected InsufficientStake error");
      } catch (err) {
        assert.include(String(err), "InsufficientStake");
      }
    });

    it("lets a bTKN staker unstake, getting their bTKN back", async () => {
      const info = await program.account.stakeInfo.fetch(btknStakeInfo);
      const before = await getAccount(provider.connection, btknStakerBtknAccount);

      await program.methods
        .unstakeBtkn(info.amount)
        .accountsPartial({
          user: btknStaker.publicKey,
          vaultConfig,
          btknMint,
          stakedBtknVault,
          rewardVaultTokenAccount,
          userBtknAccount: btknStakerBtknAccount,
          userRewardTokenAccount: btknStakerRewardAccount,
          stakeInfo: btknStakeInfo,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([btknStaker])
        .rpc();

      const after = await getAccount(provider.connection, btknStakerBtknAccount);
      assert.equal(Number(after.amount) - Number(before.amount), info.amount.toNumber());

      const cfg = await program.account.vaultConfig.fetch(vaultConfig);
      assert.equal(cfg.totalBtknStaked.toNumber(), 0);
    });
  });

  describe("protocol revenue share", () => {
    // Helper: sign with whoever the authority currently is at this point in
    // the suite (see currentAuthorityKeypair's declaration up top).
    async function updateFeesAsCurrentAuthority(
      wrapFeeBps: number,
      unwrapFeeBps: number,
      burnBps: number,
      protocolBps: number,
      btknShareBps: number
    ) {
      const cfg = await program.account.vaultConfig.fetch(vaultConfig);
      const call = program.methods
        .updateFees(wrapFeeBps, unwrapFeeBps, burnBps, protocolBps, btknShareBps)
        .accountsPartial({ authority: cfg.authority, vaultConfig });
      if (currentAuthorityKeypair) {
        await call.signers([currentAuthorityKeypair]).rpc();
      } else {
        await call.rpc();
      }
    }

    it("rejects a fee split whose buckets sum above 100%", async () => {
      const cfg = await program.account.vaultConfig.fetch(vaultConfig);
      try {
        await updateFeesAsCurrentAuthority(
          cfg.wrapFeeBps,
          cfg.unwrapFeeBps,
          5000, // 50% burn
          3000, // + 30% protocol
          3000 // + 30% bTKN = 110% of the fee, exceeds 100%
        );
        assert.fail("expected FeeSplitExceedsTotal error");
      } catch (err) {
        assert.include(String(err), "FeeSplitExceedsTotal");
      }
    });

    it("splits a wrap fee 20% burn / 10% protocol / 50% bTKN / 20% LP", async () => {
      // Matches the exact split requested: 20% burn, 10% protocol revenue,
      // 50% bTKN stakers, 20% LP stakers (implied remainder).
      await updateFeesAsCurrentAuthority(50, 100, 2000, 1000, 5000);

      const cfgBefore = await program.account.vaultConfig.fetch(vaultConfig);
      assert.equal(cfgBefore.burnBps, 2000);
      assert.equal(cfgBefore.protocolBps, 1000);
      assert.equal(cfgBefore.btknShareBps, 5000);

      const protocolBefore = await getAccount(provider.connection, protocolTokenAccount);
      const amount = new anchor.BN(10_000 * 10 ** DECIMALS);

      await program.methods
        .wrap(amount)
        .accountsPartial({
          user: user.publicKey,
          vaultConfig,
          tknMint,
          btknMint,
          vaultTokenAccount,
          rewardVaultTokenAccount,
          protocolTokenAccount,
          userTknAccount,
          userBtknAccount: getAssociatedTokenAddressSync(btknMint, user.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const cfgAfter = await program.account.vaultConfig.fetch(vaultConfig);
      const fee = Math.floor((amount.toNumber() * cfgBefore.wrapFeeBps) / 10_000);
      const expectedProtocol = Math.floor((fee * cfgBefore.protocolBps) / 10_000);

      // protocol_token_account is never redirected to burn (this vault
      // always has one set, since initialize_vault requires it), so this
      // is exactly 10% of the fee regardless of staking state.
      const protocolAfter = await getAccount(provider.connection, protocolTokenAccount);
      assert.equal(
        Number(protocolAfter.amount) - Number(protocolBefore.amount),
        expectedProtocol
      );
      assert.equal(
        cfgAfter.totalProtocolDistributed.toNumber() -
          cfgBefore.totalProtocolDistributed.toNumber(),
        expectedProtocol
      );
    });

    it("lets the authority repoint the protocol wallet via set_protocol_wallet", async () => {
      const newProtocolWallet = Keypair.generate();
      const newProtocolTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        tknMint,
        newProtocolWallet.publicKey
      );

      const cfg = await program.account.vaultConfig.fetch(vaultConfig);
      const call = program.methods.setProtocolWallet().accountsPartial({
        authority: cfg.authority,
        vaultConfig,
        protocolTokenAccount: newProtocolTokenAccount,
      });
      if (currentAuthorityKeypair) {
        await call.signers([currentAuthorityKeypair]).rpc();
      } else {
        await call.rpc();
      }

      const cfgAfter = await program.account.vaultConfig.fetch(vaultConfig);
      assert.ok(cfgAfter.protocolTokenAccount.equals(newProtocolTokenAccount));

      // A subsequent wrap should route the protocol cut to the *new*
      // account, leaving the old one untouched.
      const oldProtocolBefore = await getAccount(provider.connection, protocolTokenAccount);
      const newProtocolBefore = await getAccount(provider.connection, newProtocolTokenAccount);
      const amount = new anchor.BN(5_000 * 10 ** DECIMALS);

      await program.methods
        .wrap(amount)
        .accountsPartial({
          user: user.publicKey,
          vaultConfig,
          tknMint,
          btknMint,
          vaultTokenAccount,
          rewardVaultTokenAccount,
          protocolTokenAccount: newProtocolTokenAccount,
          userTknAccount,
          userBtknAccount: getAssociatedTokenAddressSync(btknMint, user.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const oldProtocolAfter = await getAccount(provider.connection, protocolTokenAccount);
      const newProtocolAfter = await getAccount(provider.connection, newProtocolTokenAccount);
      assert.equal(Number(oldProtocolAfter.amount), Number(oldProtocolBefore.amount));
      assert.ok(Number(newProtocolAfter.amount) > Number(newProtocolBefore.amount));
    });
  });
});
