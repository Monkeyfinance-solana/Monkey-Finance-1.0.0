import { useState } from "react";
import { useVaultData, fmtRaw } from "../hooks/useVaultData";
import { TokenTag } from "./TokenTag";
import { InfoTooltip } from "./InfoTooltip";
import type { VaultDef } from "../config";

const SOL_DECIMALS = 9;
// Reserved when MAX-filling a SOL amount, so the follow-up transaction still
// has lamports left for network fees/rent instead of failing outright.
const SOL_FEE_BUFFER = 10_000_000n; // 0.01 SOL

// Same string->raw-units conversion the hook uses internally, duplicated
// here just so the UI can check things (balance limits, LP pair estimate)
// before the user even clicks a button. Returns null for invalid input
// (empty, garbage text).
function toRawUnits(amountStr: string, decimals: number): bigint | null {
  if (!amountStr.trim()) return null;
  try {
    const [whole, frac = ""] = amountStr.split(".");
    if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) return null;
    const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
    return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
  } catch {
    return null;
  }
}

// Invalid input is treated as "over" so the button stays disabled rather
// than letting a malformed amount through.
function exceedsBalance(amountStr: string, balance: bigint, decimals: number): boolean {
  const raw = toRawUnits(amountStr, decimals);
  return raw === null || raw > balance;
}

function fmtRawUnits(raw: bigint, decimals: number): string {
  return (Number(raw) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

// Converts a raw balance straight into a plain numeric string suitable for
// putting back into an amount input (no thousands separators, exact --
// built from the bigint directly instead of via Number() to avoid precision
// loss on large balances). Used by the "MAX" button on every amount field.
function rawToInputString(raw: bigint, decimals: number): string {
  if (raw <= 0n) return "0";
  if (decimals === 0) return raw.toString();
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

// Amount input with a clickable "MAX" badge on its right edge that autofills
// the field with the full available balance.
function AmountInput({
  value,
  onChange,
  onMax,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onMax: () => void;
  placeholder: string;
}) {
  return (
    <div className="amount-input-wrap">
      <input type="text" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="max-btn" onClick={onMax}>
        MAX
      </span>
    </div>
  );
}

// Rough "how much SOL will this pull" preview for the Add LP tab, mirroring
// the current bTKN/SOL ratio in the live Raydium pool. Raydium's own
// addLiquidity call computes the real paired amount at execution time
// (with its own slippage tolerance) -- this is just a live estimate so
// people aren't guessing blind while they type.
function estimateSolNeeded(
  btknAmountStr: string,
  btknDecimals: number,
  reserves: { btkn: bigint; sol: bigint } | null
): string | null {
  if (!reserves || reserves.btkn === 0n) return null;
  const btknRaw = toRawUnits(btknAmountStr, btknDecimals);
  if (btknRaw === null || btknRaw === 0n) return null;
  const solRaw = (btknRaw * reserves.sol) / reserves.btkn;
  return fmtRawUnits(solRaw, SOL_DECIMALS);
}

// Rough "what you'll get back" preview for the Remove LP tab: your share of
// the pool (LP amount / total LP supply) applied to the pool's current
// reserves. Raydium's own withdrawLiquidity computes the real amounts at
// execution time (with its own slippage tolerance) -- this is just a live
// estimate.
function estimateRemoveLp(
  lpAmountStr: string,
  lpDecimals: number,
  btknDecimals: number,
  lpSupply: bigint,
  reserves: { btkn: bigint; sol: bigint } | null
): { btkn: string; sol: string } | null {
  if (!reserves || lpSupply === 0n) return null;
  const lpRaw = toRawUnits(lpAmountStr, lpDecimals);
  if (lpRaw === null || lpRaw === 0n) return null;
  const btknRaw = (lpRaw * reserves.btkn) / lpSupply;
  const solRaw = (lpRaw * reserves.sol) / lpSupply;
  return { btkn: fmtRawUnits(btknRaw, btknDecimals), sol: fmtRawUnits(solRaw, SOL_DECIMALS) };
}

export function VaultDetail({ vault, onBack }: { vault: VaultDef; onBack: () => void }) {
  const d = useVaultData(vault.tknMint, vault.poolId);
  const [wrapAmount, setWrapAmount] = useState("");
  const [unwrapAmount, setUnwrapAmount] = useState("");
  const [stakeAmount, setStakeAmount] = useState("");
  const [unstakeAmount, setUnstakeAmount] = useState("");
  const [lpAmount, setLpAmount] = useState("");
  const [removeLpAmount, setRemoveLpAmount] = useState("");
  const [createBtknAmount, setCreateBtknAmount] = useState("");
  const [createSolAmount, setCreateSolAmount] = useState("");
  const [stakeBtknAmount, setStakeBtknAmount] = useState("");
  const [unstakeBtknAmount, setUnstakeBtknAmount] = useState("");

  // Two tab groups instead of one big one: the left group needs no external
  // pool at all (wrap/unwrap/bTKN staking all work from the moment the
  // vault exists); the right group is everything that depends on a Raydium
  // pool + LP mint existing.
  const [coreTab, setCoreTab] = useState<"wrap" | "unwrap" | "stakebtkn" | "unstakebtkn">("wrap");
  const [lpTab, setLpTab] = useState<"addlp" | "removelp" | "stakelp" | "unstakelp">("addlp");

  return (
    <div>
      {d.msg && (
        <div className="toast-wrap">
          <div className={`toast ${d.msg.ok ? "ok" : "fail"}`}>{d.msg.text}</div>
        </div>
      )}

      <button className="ghost back-link" onClick={onBack}>
        &larr; Back to Farm Volatility
      </button>

      <div className="card-head" style={{ marginBottom: 14 }}>
        <div className="vault-title-row">
          <h2 style={{ fontSize: 20, textTransform: "none", letterSpacing: 0, color: "var(--text)" }}>
            {vault.icon} {vault.name}
          </h2>
          {d.cfg && (
            <span className={`pill inline ${d.cfg.paused ? "paused" : "active"}`}>
              <span className="dot" />
              {d.cfg.paused ? "Paused" : "Active"}
            </span>
          )}
        </div>
      </div>

      {d.loadError && (
        <div className="card">
          <div className="error">{d.loadError}</div>
        </div>
      )}

      {d.cfg && (
        <div className="card">
          <div className="card-head">
            <h2>Vault stats</h2>
            <span className="card-hint">refreshes every 5 min</span>
          </div>
          <div className="stat-grid">
            <div className="stat">
              <span className="icon">💰</span>
              <div className="label">TVL</div>
              <div className="value">{fmtRaw(d.tvl, d.decimals)} TKN</div>
            </div>
            <div className="stat">
              <span className="icon">🔥</span>
              <div className="label">Total burned</div>
              <div className="value">{fmtRaw(d.cfg.totalBurned, d.decimals)} TKN</div>
            </div>
            <div className="stat">
              <span className="icon">🔒</span>
              <div className="label">Total staked</div>
              <div className="value">{fmtRaw(d.cfg.totalStaked, d.lpDecimals)} LP</div>
            </div>
            <div className="stat">
              <span className="icon">🌱</span>
              <div className="label">Total bTKN staked</div>
              <div className="value">{fmtRaw(d.cfg.totalBtknStaked, d.decimals)} bTKN</div>
            </div>
            <div className="stat">
              <span className="icon">🎁</span>
              <div className="label">Reward pot lifetime</div>
              <div className="value">{fmtRaw(d.cfg.totalRewardDistributed, d.decimals)} TKN</div>
            </div>
            <div className="stat">
              <span className="icon">📈</span>
              <div className="label">Staker APY (est.)</div>
              <div className="value accent">{d.apy ?? "-"}</div>
            </div>
          </div>
          <div className="fee-line">
            <span>
              <b>{d.cfg.wrapFeeBps / 100}%</b> wrap fee
            </span>
            <span>
              <b>{d.cfg.unwrapFeeBps / 100}%</b> unwrap fee
            </span>
            <span>
              <b>{d.cfg.burnBps / 100}%</b> of each fee burned
            </span>
            {d.cfg.protocolBps > 0 && (
              <span>
                <b>{d.cfg.protocolBps / 100}%</b> of each fee to protocol revenue{" "}
                <InfoTooltip text="Sent directly to the vault's protocol wallet on every wrap/unwrap." />
              </span>
            )}
            <span>
              <b>{d.cfg.btknShareBps / 100}%</b> of each fee to bTKN stakers (vs. LP stakers){" "}
              <InfoTooltip text="Every fee splits into up to four flat shares: burn, protocol revenue, bTKN stakers, and LP stakers (whatever's left). This is the bTKN-staker share." />
            </span>
          </div>
        </div>
      )}

      {d.cfg && d.wallet && (
        <div className="card">
          <div className="card-head">
            <h2>Your position</h2>
          </div>

          <div className="position-stack">
            <div className="position-section">
              <div className="section-title">Balances</div>
              <div className="info-rows">
                <div className="info-row">
                  <span className="k">SOL</span>
                  <span className="v">{fmtRaw(d.userSol, SOL_DECIMALS)}</span>
                </div>
                <div className="info-row">
                  <span className="k">
                    <TokenTag label="TKN" mint={d.tknMint} />
                  </span>
                  <span className="v">{fmtRaw(d.userTkn, d.decimals)}</span>
                </div>
                <div className="info-row">
                  <span className="k">
                    <TokenTag label="bTKN" mint={d.btknMint} />
                  </span>
                  <span className="v">{fmtRaw(d.userBtkn, d.decimals)}</span>
                </div>
                <div className="info-row">
                  <span className="k">
                    <TokenTag label="bTKN" mint={d.btknMint} /> (staked)
                  </span>
                  <span className="v">{d.btknStakeInfo ? fmtRaw(d.btknStakeInfo.amount, d.decimals) : "0"}</span>
                </div>
                <div className="info-row">
                  <span className="k">Claimed (bTKN)</span>
                  <span className="v">
                    {d.btknStakeInfo ? fmtRaw(d.btknStakeInfo.totalClaimed, d.decimals) : "0"} TKN
                  </span>
                </div>
                {d.hasLpMint && (
                  <>
                    <div className="info-row">
                      <span className="k">
                        <TokenTag label="LP" mint={d.cfg.lpMint} /> (wallet)
                      </span>
                      <span className="v">{fmtRaw(d.userLp, d.lpDecimals)}</span>
                    </div>
                    <div className="info-row">
                      <span className="k">
                        <TokenTag label="LP" mint={d.cfg.lpMint} /> (staked)
                      </span>
                      <span className="v">{d.stakeInfo ? fmtRaw(d.stakeInfo.amount, d.lpDecimals) : "0"}</span>
                    </div>
                    <div className="info-row">
                      <span className="k">Claimed (LP)</span>
                      <span className="v">{d.stakeInfo ? fmtRaw(d.stakeInfo.totalClaimed, d.decimals) : "0"} TKN</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="position-section">
              <div className="section-title mixed-case">bTKN</div>
              <div className="tabs">
                <button className={`tab ${coreTab === "wrap" ? "active" : ""}`} onClick={() => setCoreTab("wrap")}>
                  Wrap
                </button>
                <button className={`tab ${coreTab === "unwrap" ? "active" : ""}`} onClick={() => setCoreTab("unwrap")}>
                  Unwrap
                </button>
                <button
                  className={`tab ${coreTab === "stakebtkn" ? "active" : ""}`}
                  onClick={() => setCoreTab("stakebtkn")}
                >
                  Stake
                </button>
                <button
                  className={`tab ${coreTab === "unstakebtkn" ? "active" : ""}`}
                  onClick={() => setCoreTab("unstakebtkn")}
                >
                  Unstake
                </button>
              </div>
              {coreTab === "wrap" && (
                <>
                  <h3>
                    <TokenTag label="TKN" mint={d.tknMint} /> <span className="arrow">&rarr;</span>{" "}
                    <TokenTag label="bTKN" mint={d.btknMint} />
                  </h3>
                  <div className="amount-form">
                    <AmountInput
                      placeholder="Amount"
                      value={wrapAmount}
                      onChange={setWrapAmount}
                      onMax={() => setWrapAmount(rawToInputString(d.userTkn, d.decimals))}
                    />
                    <button
                      disabled={d.busy !== null || exceedsBalance(wrapAmount, d.userTkn, d.decimals)}
                      onClick={() => d.wrap(wrapAmount)}
                    >
                      {d.busy === "Wrap" && <span className="spinner" />}
                      Wrap
                    </button>
                    {wrapAmount.trim() !== "" && exceedsBalance(wrapAmount, d.userTkn, d.decimals) && (
                      <div className="error">Exceeds your TKN balance.</div>
                    )}
                  </div>
                </>
              )}
              {coreTab === "unwrap" && (
                <>
                  <h3>
                    <TokenTag label="bTKN" mint={d.btknMint} /> <span className="arrow">&rarr;</span>{" "}
                    <TokenTag label="TKN" mint={d.tknMint} />
                  </h3>
                  <div className="amount-form">
                    <AmountInput
                      placeholder="Amount"
                      value={unwrapAmount}
                      onChange={setUnwrapAmount}
                      onMax={() => setUnwrapAmount(rawToInputString(d.userBtkn, d.decimals))}
                    />
                    <button
                      disabled={d.busy !== null || exceedsBalance(unwrapAmount, d.userBtkn, d.decimals)}
                      onClick={() => d.unwrap(unwrapAmount)}
                    >
                      {d.busy === "Unwrap" && <span className="spinner" />}
                      Unwrap
                    </button>
                    {unwrapAmount.trim() !== "" && exceedsBalance(unwrapAmount, d.userBtkn, d.decimals) && (
                      <div className="error">Exceeds your bTKN balance.</div>
                    )}
                  </div>
                </>
              )}
              {coreTab === "stakebtkn" && (
                <>
                  <h3>
                    Stake <TokenTag label="bTKN" mint={d.btknMint} />{" "}
                    <InfoTooltip text="Earn a share of fees without providing LP -- works immediately, no pool required. Your bTKN stays 1:1 redeemable once unstaked." />
                  </h3>
                  <div className="amount-form">
                    <AmountInput
                      placeholder="Amount"
                      value={stakeBtknAmount}
                      onChange={setStakeBtknAmount}
                      onMax={() => setStakeBtknAmount(rawToInputString(d.userBtkn, d.decimals))}
                    />
                    <button
                      disabled={d.busy !== null || exceedsBalance(stakeBtknAmount, d.userBtkn, d.decimals)}
                      onClick={() => d.stakeBtkn(stakeBtknAmount)}
                    >
                      {d.busy === "Stake bTKN" && <span className="spinner" />}
                      Stake
                    </button>
                    {stakeBtknAmount.trim() !== "" && exceedsBalance(stakeBtknAmount, d.userBtkn, d.decimals) && (
                      <div className="error">Exceeds your bTKN balance.</div>
                    )}
                  </div>
                </>
              )}
              {coreTab === "unstakebtkn" && (
                <>
                  <h3>
                    Unstake <TokenTag label="bTKN" mint={d.btknMint} />
                  </h3>
                  <div className="amount-form">
                    <AmountInput
                      placeholder="Amount"
                      value={unstakeBtknAmount}
                      onChange={setUnstakeBtknAmount}
                      onMax={() =>
                        setUnstakeBtknAmount(
                          rawToInputString(d.btknStakeInfo ? BigInt(d.btknStakeInfo.amount.toString()) : 0n, d.decimals)
                        )
                      }
                    />
                    <button
                      disabled={
                        d.busy !== null ||
                        exceedsBalance(
                          unstakeBtknAmount,
                          d.btknStakeInfo ? BigInt(d.btknStakeInfo.amount.toString()) : 0n,
                          d.decimals
                        )
                      }
                      onClick={() => d.unstakeBtkn(unstakeBtknAmount)}
                    >
                      {d.busy === "Unstake bTKN" && <span className="spinner" />}
                      Unstake
                    </button>
                    {unstakeBtknAmount.trim() !== "" &&
                      exceedsBalance(
                        unstakeBtknAmount,
                        d.btknStakeInfo ? BigInt(d.btknStakeInfo.amount.toString()) : 0n,
                        d.decimals
                      ) && <div className="error">Exceeds your staked bTKN.</div>}
                  </div>
                </>
              )}
            </div>

            <div className="position-section">
              <div className="section-title mixed-case">bTKN LP</div>
              <div className="tabs">
                <button className={`tab ${lpTab === "addlp" ? "active" : ""}`} onClick={() => setLpTab("addlp")}>
                  Add
                </button>
                <button className={`tab ${lpTab === "removelp" ? "active" : ""}`} onClick={() => setLpTab("removelp")}>
                  Remove
                </button>
                <button className={`tab ${lpTab === "stakelp" ? "active" : ""}`} onClick={() => setLpTab("stakelp")}>
                  Stake
                </button>
                <button
                  className={`tab ${lpTab === "unstakelp" ? "active" : ""}`}
                  onClick={() => setLpTab("unstakelp")}
                >
                  Unstake
                </button>
              </div>
              {lpTab === "addlp" && (
                <>
                  <h3>
                    <TokenTag label="bTKN" mint={d.btknMint} /> + SOL <span className="arrow">&rarr;</span>{" "}
                    <TokenTag label="LP" mint={d.hasLpMint ? d.cfg.lpMint : null} />{" "}
                    <InfoTooltip text="Raydium auto-computes the matching SOL amount from the pool's current reserves (1% slippage tolerance) and sends the LP token straight to your wallet." />
                  </h3>
                  {d.hasPool ? (
                    <div className="amount-form">
                      <AmountInput
                        placeholder="bTKN amount"
                        value={lpAmount}
                        onChange={setLpAmount}
                        onMax={() => setLpAmount(rawToInputString(d.userBtkn, d.decimals))}
                      />
                      <button
                        disabled={d.busy !== null || exceedsBalance(lpAmount, d.userBtkn, d.decimals)}
                        onClick={() => d.addLiquidity(lpAmount)}
                      >
                        {d.busy === "Add LP" && <span className="spinner" />}
                        Add LP
                      </button>
                      {lpAmount.trim() !== "" && exceedsBalance(lpAmount, d.userBtkn, d.decimals) && (
                        <div className="error">Exceeds your bTKN balance.</div>
                      )}
                      {lpAmount.trim() !== "" &&
                        !exceedsBalance(lpAmount, d.userBtkn, d.decimals) &&
                        (() => {
                          const est = estimateSolNeeded(lpAmount, d.decimals, d.poolReserves);
                          return est ? (
                            <div className="lp-estimate">
                              ~<b>{est} SOL</b> needed at current pool price
                            </div>
                          ) : null;
                        })()}
                    </div>
                  ) : (
                    <div className="amount-form" style={{ maxWidth: 240 }}>
                      <p className="muted" style={{ marginTop: 0 }}>
                        No pool exists yet for this vault -- create the initial{" "}
                        <TokenTag label="bTKN" mint={d.btknMint} />/SOL pool below. One-time, signed with your
                        connected wallet.
                      </p>
                      <AmountInput
                        placeholder="bTKN amount to seed"
                        value={createBtknAmount}
                        onChange={setCreateBtknAmount}
                        onMax={() => setCreateBtknAmount(rawToInputString(d.userBtkn, d.decimals))}
                      />
                      <AmountInput
                        placeholder="SOL amount to seed"
                        value={createSolAmount}
                        onChange={setCreateSolAmount}
                        onMax={() =>
                          setCreateSolAmount(
                            rawToInputString(
                              d.userSol > SOL_FEE_BUFFER ? d.userSol - SOL_FEE_BUFFER : 0n,
                              SOL_DECIMALS
                            )
                          )
                        }
                      />
                      <button
                        disabled={
                          d.busy !== null ||
                          exceedsBalance(createBtknAmount, d.userBtkn, d.decimals) ||
                          exceedsBalance(createSolAmount, d.userSol, SOL_DECIMALS)
                        }
                        onClick={() => d.createPool(createBtknAmount, createSolAmount)}
                      >
                        {d.busy === "Create Pool" && <span className="spinner" />}
                        Create Pool
                      </button>
                      {createBtknAmount.trim() !== "" && exceedsBalance(createBtknAmount, d.userBtkn, d.decimals) && (
                        <div className="error">Exceeds your bTKN balance.</div>
                      )}
                      {createSolAmount.trim() !== "" && exceedsBalance(createSolAmount, d.userSol, SOL_DECIMALS) && (
                        <div className="error">Exceeds your SOL balance.</div>
                      )}
                      {d.createdPool && (
                        <div className="lp-estimate" style={{ wordBreak: "break-all" }}>
                          Pool created. Copy these into config.ts's poolId (and set_lp_mint):
                          <br />
                          poolId: <b>{d.createdPool.poolId}</b>
                          <br />
                          lpMint: <b>{d.createdPool.lpMint}</b>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              {lpTab === "removelp" && (
                <>
                  <h3>
                    <TokenTag label="LP" mint={d.hasLpMint ? d.cfg.lpMint : null} />{" "}
                    <span className="arrow">&rarr;</span> <TokenTag label="bTKN" mint={d.btknMint} /> + SOL{" "}
                    <InfoTooltip text="Burns LP from your wallet and returns bTKN + SOL from the pool (1% slippage tolerance). Only pulls from LP sitting in your wallet -- unstake first if it's currently staked." />
                  </h3>
                  {d.hasPool ? (
                    <div className="amount-form">
                      <AmountInput
                        placeholder="LP amount"
                        value={removeLpAmount}
                        onChange={setRemoveLpAmount}
                        onMax={() => setRemoveLpAmount(rawToInputString(d.userLp, d.lpDecimals))}
                      />
                      <button
                        disabled={d.busy !== null || exceedsBalance(removeLpAmount, d.userLp, d.lpDecimals)}
                        onClick={() => d.removeLiquidity(removeLpAmount)}
                      >
                        {d.busy === "Remove LP" && <span className="spinner" />}
                        Remove LP
                      </button>
                      {removeLpAmount.trim() !== "" && exceedsBalance(removeLpAmount, d.userLp, d.lpDecimals) && (
                        <div className="error">Exceeds your wallet LP balance.</div>
                      )}
                      {removeLpAmount.trim() !== "" &&
                        !exceedsBalance(removeLpAmount, d.userLp, d.lpDecimals) &&
                        (() => {
                          const est = estimateRemoveLp(removeLpAmount, d.lpDecimals, d.decimals, d.lpSupply, d.poolReserves);
                          return est ? (
                            <div className="lp-estimate">
                              ~<b>{est.btkn} bTKN</b> + ~<b>{est.sol} SOL</b> back
                            </div>
                          ) : null;
                        })()}
                    </div>
                  ) : (
                    <p className="muted" style={{ marginTop: 8, maxWidth: 220 }}>
                      No pool exists yet -- create one from the Add LP tab first.
                    </p>
                  )}
                </>
              )}
              {lpTab === "stakelp" &&
                (d.hasLpMint ? (
                  <>
                    <h3>
                      Stake <TokenTag label="LP" mint={d.cfg.lpMint} />
                    </h3>
                    <div className="amount-form">
                      <AmountInput
                        placeholder="Amount"
                        value={stakeAmount}
                        onChange={setStakeAmount}
                        onMax={() => setStakeAmount(rawToInputString(d.userLp, d.lpDecimals))}
                      />
                      <button
                        disabled={d.busy !== null || exceedsBalance(stakeAmount, d.userLp, d.lpDecimals)}
                        onClick={() => d.stake(stakeAmount)}
                      >
                        {d.busy === "Stake" && <span className="spinner" />}
                        Stake
                      </button>
                      {stakeAmount.trim() !== "" && exceedsBalance(stakeAmount, d.userLp, d.lpDecimals) && (
                        <div className="error">Exceeds your LP balance.</div>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="muted" style={{ marginTop: 8, maxWidth: 220 }}>
                    No LP mint set on this vault yet -- create the bTKN/SOL pool and have the authority set the LP
                    mint first (see <code>scripts/set_lp_mint.ts</code>).
                  </p>
                ))}
              {lpTab === "unstakelp" &&
                (d.hasLpMint ? (
                  <>
                    <h3>
                      Unstake <TokenTag label="LP" mint={d.cfg.lpMint} />
                    </h3>
                    <div className="amount-form">
                      <AmountInput
                        placeholder="Amount"
                        value={unstakeAmount}
                        onChange={setUnstakeAmount}
                        onMax={() =>
                          setUnstakeAmount(
                            rawToInputString(d.stakeInfo ? BigInt(d.stakeInfo.amount.toString()) : 0n, d.lpDecimals)
                          )
                        }
                      />
                      <button
                        disabled={
                          d.busy !== null ||
                          exceedsBalance(unstakeAmount, d.stakeInfo ? BigInt(d.stakeInfo.amount.toString()) : 0n, d.lpDecimals)
                        }
                        onClick={() => d.unstake(unstakeAmount)}
                      >
                        {d.busy === "Unstake" && <span className="spinner" />}
                        Unstake
                      </button>
                      {unstakeAmount.trim() !== "" &&
                        exceedsBalance(unstakeAmount, d.stakeInfo ? BigInt(d.stakeInfo.amount.toString()) : 0n, d.lpDecimals) && (
                          <div className="error">Exceeds your staked LP.</div>
                        )}
                    </div>
                  </>
                ) : (
                  <p className="muted" style={{ marginTop: 8, maxWidth: 220 }}>
                    No LP mint set on this vault yet -- create the bTKN/SOL pool and have the authority set the LP
                    mint first (see <code>scripts/set_lp_mint.ts</code>).
                  </p>
                ))}
            </div>
          </div>

          {d.hasLpMint && (
            <div className="claim-row claim-row-bottom">
              <span className="amount">
                Pending LP-stake reward: <b>{fmtRaw(d.pendingReward, d.decimals)} TKN</b>
              </span>
              <button
                disabled={d.busy !== null || d.pendingReward.isZero()}
                onClick={() => d.claim()}
              >
                {d.busy === "Claim" && <span className="spinner" />}
                Claim reward
              </button>
            </div>
          )}

          <div className="claim-row claim-row-bottom">
            <span className="amount">
              Pending bTKN-stake reward: <b>{fmtRaw(d.pendingBtknReward, d.decimals)} TKN</b>
            </span>
            <button
              disabled={d.busy !== null || d.pendingBtknReward.isZero()}
              onClick={() => d.claimBtknRewards()}
            >
              {d.busy === "Claim bTKN rewards" && <span className="spinner" />}
              Claim reward
            </button>
          </div>
        </div>
      )}

      {d.cfg && !d.wallet && <p className="empty-state">Connect a wallet to wrap, unwrap, stake, or claim.</p>}
    </div>
  );
}
