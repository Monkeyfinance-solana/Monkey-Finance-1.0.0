import { useCallback, useEffect, useMemo, useState } from "react";
import * as anchor from "@anchor-lang/core";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Keypair, RpcResponseAndContext, SignatureResult } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
// Meteora DAMM v1 (dynamic-amm-sdk) -- migrated off Raydium CPMM. This is
// the classic constant-product AMM with a plain fungible LP mint, so
// stake_lp/unstake_lp/set_lp_mint on the vault program didn't need to
// change at all. See scripts/create_meteora_pool.ts and
// scripts/print_meteora_clone_cmd.ts for the local-testing bootstrap.
// Raydium's old integration is preserved in scripts/create_raydium_pool.ts
// and print_raydium_clone_cmd.ts, plus the `raydium-working` git tag, in
// case of rollback.
import AmmImpl, { PROGRAM_ID as METEORA_AMM_PROGRAM_ID } from "@meteora-ag/dynamic-amm-sdk";
import BN from "bn.js";

// These come straight from your last `anchor build` -- no copying needed,
// always in sync with whatever's currently deployed.
import idl from "../../../target/idl/pod_vault.json";
import type { PodVault } from "../../../target/types/pod_vault";

const SCALE = new anchor.BN("1000000000000");
const POLL_MS = 5 * 60 * 1000; // dashboard refresh: every 5 minutes, shared for everyone
const POOL_RESERVES_POLL_MS = 30 * 1000; // pool reserves for the Add LP estimate: cheap RPC read, refresh more often
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

// A throwaway keypair used only so read-only dashboard stats can be fetched
// before a real wallet connects. It never signs anything that matters --
// every write action below checks a real wallet is connected first.
const dummyKeypair = Keypair.generate();
const readOnlyWallet = {
  publicKey: dummyKeypair.publicKey,
  signTransaction: async (tx: any) => {
    tx.partialSign(dummyKeypair);
    return tx;
  },
  signAllTransactions: async (txs: any[]) => {
    txs.forEach((tx) => tx.partialSign(dummyKeypair));
    return txs;
  },
};

// connection.confirmTransaction() only throws on timeout/expiration -- a
// transaction that lands but fails execution on-chain still resolves
// "successfully" from the RPC's point of view, just with a non-null
// `value.err`. Every AMM-signed action (addLiquidity/removeLiquidity/
// createPool) needs this check after confirming, or a reverted transaction
// gets silently reported as a success (this is exactly what caused Create
// Pool to report a poolId/lpMint that never actually existed on-chain,
// back when this was still wired to Raydium).
function assertConfirmed(result: RpcResponseAndContext<SignatureResult>, txId: string) {
  if (result.value.err) {
    throw new Error(`Transaction ${txId} failed on-chain: ${JSON.stringify(result.value.err)}`);
  }
}

// Meteora's DAMM v1 pool address is a PDA of ["pool", firstKey, secondKey]
// where firstKey/secondKey are the two token mints canonically sorted by
// raw byte comparison -- NOT necessarily in the tokenA/tokenB order you
// pass to pool creation (see @meteora-ag/dynamic-amm-sdk's getFirstKey/
// getSecondKey). This mirrors that exact algorithm locally rather than
// depending on the SDK's internal (non-exported-at-top-level) helper, and
// is also the reason addLiquidity/refreshPoolReserves below check which
// side is actually bTKN instead of assuming tokenA -- assuming wrong here
// is exactly the class of bug that caused Raydium's 100x-pull incident.
function getFirstKey(a: PublicKey, b: PublicKey): Buffer {
  const [bufA, bufB] = [a.toBuffer(), b.toBuffer()];
  return Buffer.compare(bufA, bufB) === 1 ? bufA : bufB;
}
function getSecondKey(a: PublicKey, b: PublicKey): Buffer {
  const [bufA, bufB] = [a.toBuffer(), b.toBuffer()];
  return Buffer.compare(bufA, bufB) === 1 ? bufB : bufA;
}
function deriveMeteoraPoolAddress(tokenA: PublicKey, tokenB: PublicKey): PublicKey {
  const [poolPubkey] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), getFirstKey(tokenA, tokenB), getSecondKey(tokenA, tokenB)],
    new PublicKey(METEORA_AMM_PROGRAM_ID)
  );
  return poolPubkey;
}

export function fmtRaw(n: anchor.BN | bigint | number, decimals: number): string {
  const divisor = 10 ** decimals;
  return (Number(n.toString()) / divisor).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// One hook, used by both the compact vault cards on the Farm page (which
// only read cfg/tvl/apy) and the full vault detail page (which also needs
// the connected user's position + the wrap/unwrap/stake/unstake/claim
// actions). Pass null for tknMintStr for a "coming soon" vault with no
// on-chain address yet -- everything just stays in its empty/loading state.
export function useVaultData(tknMintStr: string | null, poolId: string | null = null) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const provider = useMemo(() => {
    return new anchor.AnchorProvider(connection, wallet ?? readOnlyWallet, {
      commitment: "confirmed",
    });
  }, [connection, wallet]);

  const program = useMemo(() => {
    return new anchor.Program(idl as anchor.Idl, provider) as unknown as anchor.Program<PodVault>;
  }, [provider]);

  const tknMint = useMemo(() => {
    if (!tknMintStr) return null;
    try {
      return new PublicKey(tknMintStr);
    } catch {
      return null;
    }
  }, [tknMintStr]);

  const [decimals, setDecimals] = useState(6);
  // Decimals for the LP mint specifically -- not necessarily the same as
  // bTKN's decimals, so stake/unstake/remove-LP amounts need their own
  // conversion rather than reusing `decimals`. Defaults to 9 (Raydium's
  // usual LP mint decimals) until the real value comes back.
  const [lpDecimals, setLpDecimals] = useState(9);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [tvl, setTvl] = useState<bigint>(0n);
  const [apy, setApy] = useState<string | null>(null);

  const [userTkn, setUserTkn] = useState<bigint>(0n);
  const [userBtkn, setUserBtkn] = useState<bigint>(0n);
  const [userLp, setUserLp] = useState<bigint>(0n);
  // Native SOL balance (lamports) -- only used to disable the Create Pool
  // form's SOL input if you try to seed more than you actually hold.
  const [userSol, setUserSol] = useState<bigint>(0n);
  const [stakeInfo, setStakeInfo] = useState<any>(null);
  const [pendingReward, setPendingReward] = useState<anchor.BN>(new anchor.BN(0));
  // bTKN-staking position -- the "stake bTKN directly, no LP needed" option.
  // Unlike stakeInfo above, this doesn't wait on cfg.lpMint being set: bTKN
  // staking works from the moment the vault exists.
  const [btknStakeInfo, setBtknStakeInfo] = useState<any>(null);
  const [pendingBtknReward, setPendingBtknReward] = useState<anchor.BN>(new anchor.BN(0));

  // Set right after a successful Create Pool call -- since the pool id isn't
  // known ahead of time (it's derived on-chain during creation), this is how
  // the UI surfaces it so it can be copied into config.ts afterward.
  const [createdPool, setCreatedPool] = useState<{ poolId: string; lpMint: string } | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Raw on-chain reserves for the bTKN/SOL Meteora pool. Meteora's DAMM v1
  // pool PDA (and Raydium's CPMM before it) canonically sorts tokenA/tokenB
  // by pubkey bytes at pool-creation time, regardless of what order
  // create_meteora_pool.ts passed them in, so bTKN is NOT guaranteed to be
  // tokenA. refreshPoolReserves below checks the resolved pool's actual
  // tokenAMint/tokenBMint against pdas.btknMint every time rather than
  // assuming an order. Used only to show a live "you'll also need ~X SOL"
  // estimate on the Add LP tab, refreshed on a short poll since it's a
  // cheap read-only RPC call.
  const [poolReserves, setPoolReserves] = useState<{ btkn: bigint; sol: bigint } | null>(null);
  // Live total supply of the LP mint -- combined with poolReserves, this is
  // what lets the UI estimate "removing X LP returns ~Y bTKN + ~Z SOL"
  // (your share of the pool = your LP amount / total LP supply).
  const [lpSupply, setLpSupply] = useState<bigint>(0n);

  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(id);
  }, [msg]);

  const pdas = useMemo(() => {
    if (!tknMint) return null;
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
    const [stakedLpVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("staked_lp"), vaultConfig.toBuffer()],
      program.programId
    );
    const [stakedBtknVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("staked_btkn"), tknMint.toBuffer()],
      program.programId
    );
    return {
      vaultConfig,
      btknMint,
      vaultTokenAccount,
      rewardVaultTokenAccount,
      stakedLpVault,
      stakedBtknVault,
    };
  }, [tknMint, program]);

  function updateApyEstimate(vaultConfigKey: string, accRewardPerShare: anchor.BN) {
    const storageKey = `pod_vault_apy_snapshot_${vaultConfigKey}`;
    const now = Date.now();
    const stored = localStorage.getItem(storageKey);

    if (!stored) {
      localStorage.setItem(storageKey, JSON.stringify({ t: now, acc: accRewardPerShare.toString() }));
      setApy("gathering data...");
      return;
    }

    const { t: prevT, acc: prevAccStr } = JSON.parse(stored);
    const elapsedSeconds = (now - prevT) / 1000;
    const prevAcc = new anchor.BN(prevAccStr);
    const delta = accRewardPerShare.sub(prevAcc);

    if (elapsedSeconds < 60 || delta.isZero()) {
      setApy(elapsedSeconds < 60 ? "gathering data..." : "0%");
      return;
    }

    const rewardPerLpToken = Number(delta.toString()) / Number(SCALE.toString());
    const annualized = rewardPerLpToken * (SECONDS_PER_YEAR / elapsedSeconds) * 100;
    setApy(`${annualized.toFixed(2)}%`);
  }

  const refreshDashboard = useCallback(async () => {
    if (!pdas) return;
    try {
      const cfgData = await program.account.vaultConfig.fetch(pdas.vaultConfig);
      setCfg(cfgData);
      const vaultBal = await connection.getTokenAccountBalance(pdas.vaultTokenAccount).catch(() => null);
      setTvl(vaultBal ? BigInt(vaultBal.value.amount) : 0n);
      updateApyEstimate(pdas.vaultConfig.toBase58(), cfgData.accRewardPerShare);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e.message ?? String(e));
    }
  }, [pdas, program, connection]);

  const refreshUser = useCallback(async () => {
    if (!pdas || !wallet || !tknMint) return;
    const userTknAcc = getAssociatedTokenAddressSync(tknMint, wallet.publicKey);
    const userBtknAcc = getAssociatedTokenAddressSync(pdas.btknMint, wallet.publicKey);

    const tknAcc = await getAccount(connection, userTknAcc).catch(() => null);
    setUserTkn(tknAcc ? tknAcc.amount : 0n);
    const btknAcc = await getAccount(connection, userBtknAcc).catch(() => null);
    setUserBtkn(btknAcc ? btknAcc.amount : 0n);
    const lamports = await connection.getBalance(wallet.publicKey).catch(() => 0);
    setUserSol(BigInt(lamports));

    if (cfg && !cfg.lpMint.equals(PublicKey.default)) {
      const userLpAcc = getAssociatedTokenAddressSync(cfg.lpMint, wallet.publicKey);
      const lpAcc = await getAccount(connection, userLpAcc).catch(() => null);
      setUserLp(lpAcc ? lpAcc.amount : 0n);

      const [stakeInfoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("stake"), pdas.vaultConfig.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );
      const info = await program.account.stakeInfo.fetch(stakeInfoPda).catch(() => null);
      setStakeInfo(info);
      if (info) {
        const accrued = info.amount.mul(cfg.accRewardPerShare).div(SCALE);
        setPendingReward(accrued.sub(info.rewardDebt));
      }
    }

    // bTKN staking has no external-pool dependency, so this is fetched
    // unconditionally (unlike the LP stake info above, which waits on
    // cfg.lpMint).
    if (cfg) {
      const [btknStakeInfoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("btkn_stake"), pdas.vaultConfig.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );
      const btknInfo = await program.account.stakeInfo.fetch(btknStakeInfoPda).catch(() => null);
      setBtknStakeInfo(btknInfo);
      if (btknInfo) {
        const accrued = btknInfo.amount.mul(cfg.accBtknRewardPerShare).div(SCALE);
        setPendingBtknReward(accrued.sub(btknInfo.rewardDebt));
      } else {
        setPendingBtknReward(new anchor.BN(0));
      }
    }
  }, [pdas, wallet, tknMint, connection, cfg, program]);

  const refreshPoolReserves = useCallback(async () => {
    if (!poolId || !pdas) return;
    try {
      // Read-only -- AmmImpl.create() does a fresh fetch + vault-adjusted
      // reserve calculation every call, so no separate updateState() needed.
      const pool = await AmmImpl.create(connection, new PublicKey(poolId));
      // pool.tokenAMint/tokenBMint come straight off the raw on-chain pool
      // account -- poolInfo.tokenAAmount always tracks tokenA's reserve,
      // tokenBAmount always tracks tokenB's, regardless of which token that
      // actually is. Don't assume bTKN is tokenA -- check.
      const btknIsTokenA = pool.tokenAMint.address.equals(pdas.btknMint);
      setPoolReserves({
        btkn: BigInt((btknIsTokenA ? pool.poolInfo.tokenAAmount : pool.poolInfo.tokenBAmount).toString()),
        sol: BigInt((btknIsTokenA ? pool.poolInfo.tokenBAmount : pool.poolInfo.tokenAAmount).toString()),
      });
    } catch {
      // Non-critical -- just means the "~X SOL needed" estimate stays hidden.
    }
  }, [poolId, connection, pdas]);

  useEffect(() => {
    if (!poolId) return;
    refreshPoolReserves();
    const id = setInterval(refreshPoolReserves, POOL_RESERVES_POLL_MS);
    return () => clearInterval(id);
  }, [poolId, refreshPoolReserves]);

  useEffect(() => {
    if (!tknMint) return;
    getMint(connection, tknMint)
      .then((info) => setDecimals(info.decimals))
      .catch(() => {});
  }, [tknMint, connection]);

  const refreshLpSupply = useCallback(async () => {
    if (!cfg || cfg.lpMint.equals(PublicKey.default)) return;
    try {
      const supply = await connection.getTokenSupply(cfg.lpMint);
      setLpDecimals(supply.value.decimals);
      setLpSupply(BigInt(supply.value.amount));
    } catch {
      // Non-critical -- just means the remove-LP estimate stays hidden.
    }
  }, [cfg, connection]);

  useEffect(() => {
    if (!cfg || cfg.lpMint.equals(PublicKey.default)) return;
    refreshLpSupply();
    const id = setInterval(refreshLpSupply, POOL_RESERVES_POLL_MS);
    return () => clearInterval(id);
  }, [cfg, refreshLpSupply]);

  useEffect(() => {
    if (!pdas) return;
    refreshDashboard();
    const id = setInterval(refreshDashboard, POLL_MS);
    return () => clearInterval(id);
  }, [pdas, refreshDashboard]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  function toRawWithDecimals(amountStr: string, dec: number): anchor.BN {
    const [whole, frac = ""] = amountStr.split(".");
    const fracPadded = (frac + "0".repeat(dec)).slice(0, dec);
    return new anchor.BN(whole || "0").mul(new anchor.BN(10).pow(new anchor.BN(dec))).add(new anchor.BN(fracPadded || "0"));
  }

  // TKN/bTKN amounts (wrap, unwrap, the bTKN side of Add LP).
  function toRaw(amountStr: string): anchor.BN {
    return toRawWithDecimals(amountStr, decimals);
  }

  // LP-token amounts (stake, unstake, remove LP) -- the LP mint isn't
  // guaranteed to share bTKN's decimals, so this uses lpDecimals instead.
  function toRawLp(amountStr: string): anchor.BN {
    return toRawWithDecimals(amountStr, lpDecimals);
  }

  async function runAction(name: string, fn: () => Promise<string>) {
    if (!wallet) {
      setMsg({ text: "Connect a wallet first.", ok: false });
      return;
    }
    setBusy(name);
    setMsg(null);
    try {
      const sig = await fn();
      setMsg({ text: `${name} succeeded: ${sig.slice(0, 16)}...`, ok: true });
      await Promise.all([refreshDashboard(), refreshUser()]);
    } catch (e: any) {
      setMsg({ text: e.message ?? String(e), ok: false });
    } finally {
      setBusy(null);
    }
  }

  async function wrap(amountStr: string) {
    if (!pdas || !wallet || !tknMint || !cfg) return;
    await runAction("Wrap", async () => {
      const userTknAcc = getAssociatedTokenAddressSync(tknMint, wallet.publicKey);
      const userBtknAcc = getAssociatedTokenAddressSync(pdas.btknMint, wallet.publicKey);
      return program.methods
        .wrap(toRaw(amountStr))
        .accountsPartial({
          user: wallet.publicKey,
          vaultConfig: pdas.vaultConfig,
          tknMint,
          btknMint: pdas.btknMint,
          vaultTokenAccount: pdas.vaultTokenAccount,
          rewardVaultTokenAccount: pdas.rewardVaultTokenAccount,
          protocolTokenAccount: cfg.protocolTokenAccount,
          userTknAccount: userTknAcc,
          userBtknAccount: userBtknAcc,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    });
  }

  async function unwrap(amountStr: string) {
    if (!pdas || !wallet || !tknMint || !cfg) return;
    await runAction("Unwrap", async () => {
      const userTknAcc = getAssociatedTokenAddressSync(tknMint, wallet.publicKey);
      const userBtknAcc = getAssociatedTokenAddressSync(pdas.btknMint, wallet.publicKey);
      return program.methods
        .unwrap(toRaw(amountStr))
        .accountsPartial({
          user: wallet.publicKey,
          vaultConfig: pdas.vaultConfig,
          tknMint,
          btknMint: pdas.btknMint,
          vaultTokenAccount: pdas.vaultTokenAccount,
          rewardVaultTokenAccount: pdas.rewardVaultTokenAccount,
          protocolTokenAccount: cfg.protocolTokenAccount,
          userTknAccount: userTknAcc,
          userBtknAccount: userBtknAcc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    });
  }

  async function stake(amountStr: string) {
    if (!pdas || !wallet || !cfg) return;
    await runAction("Stake", async () => {
      const userLpAcc = getAssociatedTokenAddressSync(cfg.lpMint, wallet.publicKey);
      const userTknAcc = getAssociatedTokenAddressSync(tknMint!, wallet.publicKey);
      const [stakeInfoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("stake"), pdas.vaultConfig.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );
      return program.methods
        .stakeLp(toRawLp(amountStr))
        .accountsPartial({
          user: wallet.publicKey,
          vaultConfig: pdas.vaultConfig,
          lpMint: cfg.lpMint,
          stakedLpVault: pdas.stakedLpVault,
          rewardVaultTokenAccount: pdas.rewardVaultTokenAccount,
          userLpTokenAccount: userLpAcc,
          userRewardTokenAccount: userTknAcc,
          stakeInfo: stakeInfoPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    });
  }

  async function unstake(amountStr: string) {
    if (!pdas || !wallet || !cfg) return;
    await runAction("Unstake", async () => {
      const userLpAcc = getAssociatedTokenAddressSync(cfg.lpMint, wallet.publicKey);
      const userTknAcc = getAssociatedTokenAddressSync(tknMint!, wallet.publicKey);
      const [stakeInfoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("stake"), pdas.vaultConfig.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );
      return program.methods
        .unstakeLp(toRawLp(amountStr))
        .accountsPartial({
          user: wallet.publicKey,
          vaultConfig: pdas.vaultConfig,
          lpMint: cfg.lpMint,
          stakedLpVault: pdas.stakedLpVault,
          rewardVaultTokenAccount: pdas.rewardVaultTokenAccount,
          userLpTokenAccount: userLpAcc,
          userRewardTokenAccount: userTknAcc,
          stakeInfo: stakeInfoPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    });
  }

  async function claim() {
    if (!pdas || !wallet || !tknMint) return;
    await runAction("Claim", async () => {
      const userTknAcc = getAssociatedTokenAddressSync(tknMint, wallet.publicKey);
      const [stakeInfoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("stake"), pdas.vaultConfig.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );
      return program.methods
        .claimRewards()
        .accountsPartial({
          user: wallet.publicKey,
          vaultConfig: pdas.vaultConfig,
          rewardVaultTokenAccount: pdas.rewardVaultTokenAccount,
          userRewardTokenAccount: userTknAcc,
          stakeInfo: stakeInfoPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    });
  }

  // Stake bTKN directly -- the option for holders who don't want to
  // provide/stake LP. Works immediately (no pool/lp_mint dependency).
  async function stakeBtkn(amountStr: string) {
    if (!pdas || !wallet || !tknMint) return;
    await runAction("Stake bTKN", async () => {
      const userBtknAcc = getAssociatedTokenAddressSync(pdas.btknMint, wallet.publicKey);
      const userTknAcc = getAssociatedTokenAddressSync(tknMint, wallet.publicKey);
      const [btknStakeInfoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("btkn_stake"), pdas.vaultConfig.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );
      return program.methods
        .stakeBtkn(toRaw(amountStr))
        .accountsPartial({
          user: wallet.publicKey,
          vaultConfig: pdas.vaultConfig,
          btknMint: pdas.btknMint,
          stakedBtknVault: pdas.stakedBtknVault,
          rewardVaultTokenAccount: pdas.rewardVaultTokenAccount,
          userBtknAccount: userBtknAcc,
          userRewardTokenAccount: userTknAcc,
          stakeInfo: btknStakeInfoPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    });
  }

  async function unstakeBtkn(amountStr: string) {
    if (!pdas || !wallet || !tknMint) return;
    await runAction("Unstake bTKN", async () => {
      const userBtknAcc = getAssociatedTokenAddressSync(pdas.btknMint, wallet.publicKey);
      const userTknAcc = getAssociatedTokenAddressSync(tknMint, wallet.publicKey);
      const [btknStakeInfoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("btkn_stake"), pdas.vaultConfig.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );
      return program.methods
        .unstakeBtkn(toRaw(amountStr))
        .accountsPartial({
          user: wallet.publicKey,
          vaultConfig: pdas.vaultConfig,
          btknMint: pdas.btknMint,
          stakedBtknVault: pdas.stakedBtknVault,
          rewardVaultTokenAccount: pdas.rewardVaultTokenAccount,
          userBtknAccount: userBtknAcc,
          userRewardTokenAccount: userTknAcc,
          stakeInfo: btknStakeInfoPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    });
  }

  async function claimBtknRewards() {
    if (!pdas || !wallet || !tknMint) return;
    await runAction("Claim bTKN rewards", async () => {
      const userTknAcc = getAssociatedTokenAddressSync(tknMint, wallet.publicKey);
      const [btknStakeInfoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("btkn_stake"), pdas.vaultConfig.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );
      return program.methods
        .claimBtknRewards()
        .accountsPartial({
          user: wallet.publicKey,
          vaultConfig: pdas.vaultConfig,
          rewardVaultTokenAccount: pdas.rewardVaultTokenAccount,
          userRewardTokenAccount: userTknAcc,
          stakeInfo: btknStakeInfoPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    });
  }

  // Deposits bTKN + SOL into the live Meteora DAMM v1 pool (bootstrapped via
  // scripts/create_meteora_pool.ts) and mints the pool's LP token straight
  // into the connected wallet. Meteora auto-computes the paired SOL amount
  // from current pool reserves via getDepositQuote -- the user only enters
  // a bTKN amount.
  //
  // NOTE: the deposit()/withdraw() param semantics below (which quote field
  // maps to which positional argument) are inferred from the SDK's
  // TypeScript signatures and getDepositQuote/getWithdrawQuote's own
  // slippage-adjustment logic, not from having run this against a live
  // pool yet. Test with a small amount first and confirm the wallet's bTKN
  // balance drops by exactly what you entered -- the same way the
  // Raydium 100x-pull bug was caught.
  async function addLiquidity(btknAmountStr: string) {
    if (!wallet || !wallet.signTransaction || !poolId || !pdas) return;
    await runAction("Add LP", async () => {
      const pool = await AmmImpl.create(connection, new PublicKey(poolId));

      // Meteora's pool PDA canonically sorts tokenA/tokenB by pubkey bytes
      // at creation time -- bTKN isn't guaranteed to be tokenA. Check the
      // resolved pool instead of assuming (see deriveMeteoraPoolAddress's
      // comment -- this is the same bug class as Raydium's 100x-pull).
      const btknIsTokenA = pool.tokenAMint.address.equals(pdas.btknMint);
      if (!btknIsTokenA && !pool.tokenBMint.address.equals(pdas.btknMint)) {
        throw new Error("Pool's tokens don't match this vault's bTKN/SOL pair.");
      }

      const btknRaw = new BN(toRaw(btknAmountStr).toString());
      const [tokenAInAmount, tokenBInAmount] = btknIsTokenA ? [btknRaw, new BN(0)] : [new BN(0), btknRaw];

      // `balance=true` with one side zero means "auto-compute the other
      // side from current reserves", same role Raydium's addLiquidity
      // baseIn/inputAmount played.
      const quote = pool.getDepositQuote(tokenAInAmount, tokenBInAmount, true, 1); // 1% slippage

      const tx = await pool.deposit(
        wallet.publicKey,
        quote.tokenAInAmount,
        quote.tokenBInAmount,
        quote.minPoolTokenAmountOut
      );

      const signed = await wallet.signTransaction(tx);
      const txId = await connection.sendRawTransaction(signed.serialize());

      // Same confirmation-race + failure-check fix used everywhere else
      // that signs its own transaction outside Anchor's .rpc().
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      const result = await connection.confirmTransaction({ signature: txId, ...latestBlockhash }, "confirmed");
      assertConfirmed(result, txId);

      refreshPoolReserves(); // pool reserves + LP supply both just moved -- refresh the live estimates too
      refreshLpSupply();

      return txId;
    });
  }

  // The reverse of addLiquidity: burns an LP amount and returns bTKN + SOL
  // to the connected wallet, straight from the Meteora pool. Independent of
  // stake_lp/unstake_lp -- this only ever touches LP sitting in the wallet,
  // so unstake first if the LP you want back is currently staked.
  async function removeLiquidity(lpAmountStr: string) {
    if (!wallet || !wallet.signTransaction || !poolId) return;
    await runAction("Remove LP", async () => {
      const pool = await AmmImpl.create(connection, new PublicKey(poolId));

      const lpRaw = new BN(toRawLp(lpAmountStr).toString());
      const quote = pool.getWithdrawQuote(lpRaw, 1); // balanced withdraw (no tokenMint arg), 1% slippage

      const tx = await pool.withdraw(
        wallet.publicKey,
        quote.poolTokenAmountIn,
        quote.minTokenAOutAmount,
        quote.minTokenBOutAmount
      );

      const signed = await wallet.signTransaction(tx);
      const txId = await connection.sendRawTransaction(signed.serialize());

      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      const result = await connection.confirmTransaction({ signature: txId, ...latestBlockhash }, "confirmed");
      assertConfirmed(result, txId);

      refreshPoolReserves();
      refreshLpSupply();

      return txId;
    });
  }

  // One-time bootstrap: creates the bTKN/SOL Meteora DAMM v1 pool itself,
  // signed entirely by the connected wallet (Phantom -- no local CLI
  // keypair or exported private key needed). Mirrors
  // scripts/create_meteora_pool.ts, just browser-signed. Meteora's
  // createCustomizablePermissionlessConstantProductPool doesn't hand back
  // the resulting pool address directly, so it's recomputed the same way
  // Meteora derives it (deriveMeteoraPoolAddress) and surfaced via
  // `createdPool` for you to copy into config.ts afterward.
  async function createPool(btknAmountStr: string, solAmountStr: string) {
    if (!wallet || !wallet.signTransaction || !pdas) return;
    setCreatedPool(null);
    await runAction("Create Pool", async () => {
      const tokenAMint = pdas.btknMint;
      const tokenBMint = NATIVE_MINT;

      const tx = await AmmImpl.createCustomizablePermissionlessConstantProductPool(
        connection,
        wallet.publicKey,
        tokenAMint,
        tokenBMint,
        new BN(toRaw(btknAmountStr).toString()),
        new BN(toRawWithDecimals(solAmountStr, 9).toString()),
        {
          // tradeFeeNumerator is out of FEE_DENOMINATOR = 100_000 on-chain
          // (NOT 10_000/bps -- that assumption caused an "InvalidFee"
          // revert here). numerator = bps * 10 (confirmed via mercurial-amm
          // source + the SDK's own createConfig conversion). 1000/100_000 =
          // 1% trading fee to LPs, comfortably under the program's own
          // MAX_FEE_DBPS cap (6%).
          tradeFeeNumerator: 1000,
          activationPoint: null, // trade immediately, no delayed launch
          hasAlphaVault: false,
          activationType: 1, // 1 = timestamp-based (0 = slot-based)
          padding: new Array(90).fill(0),
        }
      );

      const signed = await wallet.signTransaction(tx);
      const txId = await connection.sendRawTransaction(signed.serialize());

      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      const result = await connection.confirmTransaction({ signature: txId, ...latestBlockhash }, "confirmed");
      assertConfirmed(result, txId);

      const poolPubkey = deriveMeteoraPoolAddress(tokenAMint, tokenBMint);
      const [lpMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("lp_mint"), poolPubkey.toBuffer()],
        new PublicKey(METEORA_AMM_PROGRAM_ID)
      );

      setCreatedPool({
        poolId: poolPubkey.toBase58(),
        lpMint: lpMint.toBase58(),
      });

      return txId;
    });
  }

  const hasLpMint = !!(cfg && !cfg.lpMint.equals(PublicKey.default));
  const hasPool = !!poolId;

  return {
    wallet,
    tknMint,
    btknMint: pdas?.btknMint ?? null,
    decimals,
    lpDecimals,
    loadError,
    cfg,
    tvl,
    apy,
    hasLpMint,
    hasPool,
    poolReserves,
    lpSupply,
    userTkn,
    userBtkn,
    userLp,
    userSol,
    stakeInfo,
    pendingReward,
    btknStakeInfo,
    pendingBtknReward,
    busy,
    msg,
    createdPool,
    wrap,
    unwrap,
    stake,
    unstake,
    claim,
    stakeBtkn,
    unstakeBtkn,
    claimBtknRewards,
    addLiquidity,
    removeLiquidity,
    createPool,
  };
}
