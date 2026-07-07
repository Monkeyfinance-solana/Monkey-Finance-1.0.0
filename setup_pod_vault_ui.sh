#!/usr/bin/env bash
# Basic front-end for pod_vault: a dashboard (TVL, total burned, staker gains,
# APY) plus wallet-connected actions (wrap/unwrap/stake/unstake/claim).
#
# Run this from INSIDE your pod_vault project directory (it creates ./app):
#   cd ~/projects/pod_vault
#   bash setup_pod_vault_ui.sh
#   cd app
#   npm install
#   npm run dev
#
# It's created as a subfolder of pod_vault (not a sibling project) so it can
# import your program's IDL/types directly from ../target/idl and
# ../target/types -- always in sync with whatever you last built, no copying
# needed. Requires you've already run `anchor build` at least once so those
# files exist.
#
# Points at http://127.0.0.1:8899 (your local validator) by default. Needs a
# browser wallet extension (Phantom, Solflare, Backpack, etc.) installed --
# it uses Wallet Standard auto-detection, so any installed wallet should
# just show up in the connect button with no extra config.
set -e

ROOT="app"
mkdir -p "$ROOT/src"

# ---------------------------------------------------------------------------
# app/package.json
# ---------------------------------------------------------------------------
cat <<'EOF' > "$ROOT/package.json"
{
  "name": "pod-vault-ui",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@anchor-lang/core": "^1.1.2",
    "@solana/wallet-adapter-base": "^0.9.23",
    "@solana/wallet-adapter-react": "^0.15.35",
    "@solana/wallet-adapter-react-ui": "^0.9.35",
    "@solana/web3.js": "^1.95.3",
    "@solana/spl-token": "^0.4.8",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.1",
    "vite-plugin-node-polyfills": "^0.22.0"
  }
}
EOF

# ---------------------------------------------------------------------------
# app/vite.config.ts
# ---------------------------------------------------------------------------
cat <<'EOF' > "$ROOT/vite.config.ts"
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// @solana/web3.js and Anchor expect Node globals (Buffer, process) that
// don't exist in the browser by default -- this plugin polyfills them.
// Without it you'll hit a "Buffer is not defined" crash the moment any
// Solana code runs.
export default defineConfig({
  plugins: [react(), nodePolyfills()],
  server: {
    port: 5173,
  },
});
EOF

# ---------------------------------------------------------------------------
# app/tsconfig.json
# ---------------------------------------------------------------------------
cat <<'EOF' > "$ROOT/tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": false
  },
  "include": ["src", "../target/types"]
}
EOF

# ---------------------------------------------------------------------------
# app/index.html
# ---------------------------------------------------------------------------
cat <<'EOF' > "$ROOT/index.html"
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>pod_vault dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
EOF

# ---------------------------------------------------------------------------
# app/src/index.css
# ---------------------------------------------------------------------------
cat <<'EOF' > "$ROOT/src/index.css"
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #0b0d12;
  color: #e6e8eb;
}
.container { max-width: 880px; margin: 0 auto; padding: 24px; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.header h1 { font-size: 20px; margin: 0; }
.card {
  background: #14171f;
  border: 1px solid #23272f;
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 20px;
}
.card h2 { margin-top: 0; font-size: 16px; color: #9aa4b2; text-transform: uppercase; letter-spacing: 0.04em; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; }
.stat { background: #0f1218; border-radius: 8px; padding: 12px 16px; }
.stat .label { font-size: 12px; color: #7d8794; }
.stat .value { font-size: 20px; font-weight: 600; margin-top: 4px; }
.row { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
input[type="text"], input[type="number"] {
  background: #0f1218;
  border: 1px solid #2a2f39;
  border-radius: 6px;
  padding: 8px 10px;
  color: #e6e8eb;
  flex: 1;
  min-width: 120px;
}
button {
  background: #3d6bff;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  color: white;
  font-weight: 600;
  cursor: pointer;
}
button:disabled { background: #2a2f39; cursor: not-allowed; color: #6b7280; }
button.secondary { background: #23272f; }
.action-block { border-top: 1px solid #23272f; padding-top: 14px; margin-top: 14px; }
.action-block h3 { margin: 0 0 8px 0; font-size: 14px; }
.error { color: #ff6b6b; font-size: 13px; margin-top: 6px; }
.success { color: #6bff9e; font-size: 13px; margin-top: 6px; }
.muted { color: #7d8794; font-size: 13px; }
EOF

echo "app scaffold (part 1/2) created. Continuing with main.tsx and App.tsx..."

# ---------------------------------------------------------------------------
# app/src/main.tsx
# ---------------------------------------------------------------------------
cat <<'EOF' > "$ROOT/src/main.tsx"
import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import App from "./App";
import "./index.css";

const RPC_URL = "http://127.0.0.1:8899";

function Root() {
  // Empty wallets array + autoConnect relies on Wallet Standard
  // auto-detection -- any installed wallet extension (Phantom, Solflare,
  // Backpack, etc.) registers itself automatically and will show up in the
  // connect button without needing to import a specific adapter here.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App connectButton={<WalletMultiButton />} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
EOF

echo "main.tsx done. Writing App.tsx (this is the big one)..."

# ---------------------------------------------------------------------------
# app/src/App.tsx
# ---------------------------------------------------------------------------
cat <<'EOF' > "$ROOT/src/App.tsx"
import { useCallback, useEffect, useMemo, useState } from "react";
import * as anchor from "@anchor-lang/core";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// These come straight from your last `anchor build` -- no copying needed,
// always in sync with whatever's currently deployed.
import idl from "../../target/idl/pod_vault.json";
import type { PodVault } from "../../target/types/pod_vault";

const SCALE = new anchor.BN("1000000000000");
const POLL_MS = 5 * 60 * 1000; // dashboard refresh: every 5 minutes, shared for everyone
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

// A throwaway keypair used only so read-only dashboard stats can be fetched
// before a real wallet connects. It never signs anything that matters --
// every write action below checks a real wallet is connected first. Built
// as a plain object matching AnchorProvider's expected Wallet shape,
// since @anchor-lang/core doesn't export a `Wallet` class to `new` up.
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

function fmtRaw(n: anchor.BN | bigint | number, decimals: number): string {
  const divisor = 10 ** decimals;
  return (Number(n.toString()) / divisor).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function App({ connectButton }: { connectButton: React.ReactNode }) {
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

  const [tknMintInput, setTknMintInput] = useState("");
  const [tknMint, setTknMint] = useState<PublicKey | null>(null);
  const [decimals, setDecimals] = useState(6);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [cfg, setCfg] = useState<any>(null);
  const [tvl, setTvl] = useState<bigint>(0n);
  const [apy, setApy] = useState<string | null>(null);

  const [userTkn, setUserTkn] = useState<bigint>(0n);
  const [userPtkn, setUserPtkn] = useState<bigint>(0n);
  const [userLp, setUserLp] = useState<bigint>(0n);
  const [stakeInfo, setStakeInfo] = useState<any>(null);
  const [pendingReward, setPendingReward] = useState<anchor.BN>(new anchor.BN(0));

  const [wrapAmount, setWrapAmount] = useState("");
  const [unwrapAmount, setUnwrapAmount] = useState("");
  const [stakeAmount, setStakeAmount] = useState("");
  const [unstakeAmount, setUnstakeAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // ---- derived PDAs, recomputed whenever tknMint changes ----
  const pdas = useMemo(() => {
    if (!tknMint) return null;
    const [vaultConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tknMint.toBuffer()],
      program.programId
    );
    const [ptknMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("ptkn_mint"), tknMint.toBuffer()],
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
    return { vaultConfig, ptknMint, vaultTokenAccount, rewardVaultTokenAccount, stakedLpVault };
  }, [tknMint, program]);

  // ---- APY snapshot bookkeeping (localStorage-based, see conversation for the idea) ----
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
      setApy(elapsedSeconds < 60 ? "gathering data..." : "0% (no reward activity yet)");
      return;
    }

    // (delta / SCALE) = TKN earned per 1 LP token staked over elapsedSeconds.
    // Annualize by projecting that rate forward across a full year.
    const rewardPerLpToken = Number(delta.toString()) / Number(SCALE.toString());
    const annualized = rewardPerLpToken * (SECONDS_PER_YEAR / elapsedSeconds) * 100;
    setApy(`${annualized.toFixed(2)}%${elapsedSeconds < 3600 ? " (early estimate, noisy)" : ""}`);
  }

  // ---- fetch dashboard state ----
  const refreshDashboard = useCallback(async () => {
    if (!pdas) return;
    try {
      const cfgData = await program.account.vaultConfig.fetch(pdas.vaultConfig);
      setCfg(cfgData);
      const vaultBal = await connection.getTokenAccountBalance(pdas.vaultTokenAccount).catch(() => null);
      setTvl(vaultBal ? BigInt(vaultBal.value.amount) : 0n);
      updateApyEstimate(pdas.vaultConfig.toBase58(), cfgData.accRewardPerShare);
    } catch (e: any) {
      setLoadError(e.message ?? String(e));
    }
  }, [pdas, program, connection]);

  // ---- fetch the connected user's own balances/position ----
  const refreshUser = useCallback(async () => {
    if (!pdas || !wallet || !tknMint) return;
    const userTknAcc = getAssociatedTokenAddressSync(tknMint, wallet.publicKey);
    const userPtknAcc = getAssociatedTokenAddressSync(pdas.ptknMint, wallet.publicKey);

    const tknAcc = await getAccount(connection, userTknAcc).catch(() => null);
    setUserTkn(tknAcc ? tknAcc.amount : 0n);
    const ptknAcc = await getAccount(connection, userPtknAcc).catch(() => null);
    setUserPtkn(ptknAcc ? ptknAcc.amount : 0n);

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
  }, [pdas, wallet, tknMint, connection, cfg, program]);

  async function loadVault() {
    setLoadError(null);
    setCfg(null);
    try {
      const mint = new PublicKey(tknMintInput.trim());
      const mintInfo = await getMint(connection, mint);
      setDecimals(mintInfo.decimals);
      setTknMint(mint);
    } catch (e: any) {
      setLoadError("Couldn't read that mint -- check the address and that your validator is running.");
    }
  }

  useEffect(() => {
    if (!pdas) return;
    refreshDashboard();
    const id = setInterval(refreshDashboard, POLL_MS);
    return () => clearInterval(id);
  }, [pdas, refreshDashboard]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // ---- action helpers ----
  function toRaw(amountStr: string): anchor.BN {
    const [whole, frac = ""] = amountStr.split(".");
    const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
    return new anchor.BN(whole || "0").mul(new anchor.BN(10).pow(new anchor.BN(decimals))).add(new anchor.BN(fracPadded || "0"));
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

  async function handleWrap() {
    if (!pdas || !wallet || !tknMint) return;
    await runAction("Wrap", async () => {
      const userTknAcc = getAssociatedTokenAddressSync(tknMint, wallet.publicKey);
      const userPtknAcc = getAssociatedTokenAddressSync(pdas.ptknMint, wallet.publicKey);
      return program.methods
        .wrap(toRaw(wrapAmount))
        .accountsPartial({
          user: wallet.publicKey,
          vaultConfig: pdas.vaultConfig,
          tknMint,
          ptknMint: pdas.ptknMint,
          vaultTokenAccount: pdas.vaultTokenAccount,
          rewardVaultTokenAccount: pdas.rewardVaultTokenAccount,
          userTknAccount: userTknAcc,
          userPtknAccount: userPtknAcc,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    });
  }

  async function handleUnwrap() {
    if (!pdas || !wallet || !tknMint) return;
    await runAction("Unwrap", async () => {
      const userTknAcc = getAssociatedTokenAddressSync(tknMint, wallet.publicKey);
      const userPtknAcc = getAssociatedTokenAddressSync(pdas.ptknMint, wallet.publicKey);
      return program.methods
        .unwrap(toRaw(unwrapAmount))
        .accountsPartial({
          user: wallet.publicKey,
          vaultConfig: pdas.vaultConfig,
          tknMint,
          ptknMint: pdas.ptknMint,
          vaultTokenAccount: pdas.vaultTokenAccount,
          rewardVaultTokenAccount: pdas.rewardVaultTokenAccount,
          userTknAccount: userTknAcc,
          userPtknAccount: userPtknAcc,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    });
  }

  async function handleStake() {
    if (!pdas || !wallet || !cfg) return;
    await runAction("Stake", async () => {
      const userLpAcc = getAssociatedTokenAddressSync(cfg.lpMint, wallet.publicKey);
      const userTknAcc = getAssociatedTokenAddressSync(tknMint!, wallet.publicKey);
      const [stakeInfoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("stake"), pdas.vaultConfig.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );
      return program.methods
        .stakeLp(toRaw(stakeAmount))
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

  async function handleUnstake() {
    if (!pdas || !wallet || !cfg) return;
    await runAction("Unstake", async () => {
      const userLpAcc = getAssociatedTokenAddressSync(cfg.lpMint, wallet.publicKey);
      const userTknAcc = getAssociatedTokenAddressSync(tknMint!, wallet.publicKey);
      const [stakeInfoPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("stake"), pdas.vaultConfig.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );
      return program.methods
        .unstakeLp(toRaw(unstakeAmount))
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

  async function handleClaim() {
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

  const hasLpMint = cfg && !cfg.lpMint.equals(PublicKey.default);

  return (
    <div className="container">
      <div className="header">
        <h1>pod_vault dashboard</h1>
        {connectButton}
      </div>

      <div className="card">
        <h2>Load a vault</h2>
        <div className="row">
          <input
            type="text"
            placeholder="TKN mint address"
            value={tknMintInput}
            onChange={(e) => setTknMintInput(e.target.value)}
          />
          <button onClick={loadVault}>Load</button>
        </div>
        {loadError && <div className="error">{loadError}</div>}
        {tknMint && <div className="muted">Loaded: {tknMint.toBase58()}</div>}
      </div>

      {cfg && (
        <div className="card">
          <h2>Vault stats (refreshes every 5 min)</h2>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">TVL</div>
              <div className="value">{fmtRaw(tvl, decimals)} TKN</div>
            </div>
            <div className="stat">
              <div className="label">Total burned</div>
              <div className="value">{fmtRaw(cfg.totalBurned, decimals)} TKN</div>
            </div>
            <div className="stat">
              <div className="label">Total staked</div>
              <div className="value">{fmtRaw(cfg.totalStaked, decimals)} LP</div>
            </div>
            <div className="stat">
              <div className="label">Reward pot lifetime</div>
              <div className="value">{fmtRaw(cfg.totalRewardDistributed, decimals)} TKN</div>
            </div>
            <div className="stat">
              <div className="label">Staker APY (est.)</div>
              <div className="value">{apy ?? "-"}</div>
            </div>
            <div className="stat">
              <div className="label">Status</div>
              <div className="value">{cfg.paused ? "Paused" : "Active"}</div>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 12 }}>
            Wrap fee {cfg.wrapFeeBps / 100}% / Unwrap fee {cfg.unwrapFeeBps / 100}% / {cfg.burnBps / 100}% of each fee burned
          </p>
        </div>
      )}

      {cfg && wallet && (
        <div className="card">
          <h2>Your position</h2>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Your TKN</div>
              <div className="value">{fmtRaw(userTkn, decimals)}</div>
            </div>
            <div className="stat">
              <div className="label">Your pTKN</div>
              <div className="value">{fmtRaw(userPtkn, decimals)}</div>
            </div>
            {hasLpMint && (
              <>
                <div className="stat">
                  <div className="label">Your LP (wallet)</div>
                  <div className="value">{fmtRaw(userLp, decimals)}</div>
                </div>
                <div className="stat">
                  <div className="label">Your LP (staked)</div>
                  <div className="value">{stakeInfo ? fmtRaw(stakeInfo.amount, decimals) : "0"}</div>
                </div>
                <div className="stat">
                  <div className="label">Pending reward</div>
                  <div className="value">{fmtRaw(pendingReward, decimals)} TKN</div>
                </div>
                <div className="stat">
                  <div className="label">Total ever claimed</div>
                  <div className="value">{stakeInfo ? fmtRaw(stakeInfo.totalClaimed, decimals) : "0"} TKN</div>
                </div>
              </>
            )}
          </div>

          <div className="action-block">
            <h3>Wrap TKN &rarr; pTKN</h3>
            <div className="row">
              <input type="text" placeholder="Amount" value={wrapAmount} onChange={(e) => setWrapAmount(e.target.value)} />
              <button disabled={busy !== null} onClick={handleWrap}>{busy === "Wrap" ? "..." : "Wrap"}</button>
            </div>
          </div>

          <div className="action-block">
            <h3>Unwrap pTKN &rarr; TKN</h3>
            <div className="row">
              <input type="text" placeholder="Amount" value={unwrapAmount} onChange={(e) => setUnwrapAmount(e.target.value)} />
              <button disabled={busy !== null} onClick={handleUnwrap}>{busy === "Unwrap" ? "..." : "Unwrap"}</button>
            </div>
          </div>

          {hasLpMint ? (
            <>
              <div className="action-block">
                <h3>Stake LP</h3>
                <div className="row">
                  <input type="text" placeholder="Amount" value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)} />
                  <button disabled={busy !== null} onClick={handleStake}>{busy === "Stake" ? "..." : "Stake"}</button>
                </div>
              </div>
              <div className="action-block">
                <h3>Unstake LP</h3>
                <div className="row">
                  <input type="text" placeholder="Amount" value={unstakeAmount} onChange={(e) => setUnstakeAmount(e.target.value)} />
                  <button disabled={busy !== null} onClick={handleUnstake}>{busy === "Unstake" ? "..." : "Unstake"}</button>
                  <button className="secondary" disabled={busy !== null} onClick={handleClaim}>
                    {busy === "Claim" ? "..." : "Claim reward"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="muted action-block">No LP mint set on this vault yet -- staking isn't available.</p>
          )}

          {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
        </div>
      )}

      {cfg && !wallet && <p className="muted">Connect a wallet to wrap, unwrap, stake, or claim.</p>}
    </div>
  );
}
EOF

echo "pod_vault UI created in ./$ROOT"
echo "Next: cd $ROOT && npm install && npm run dev"
