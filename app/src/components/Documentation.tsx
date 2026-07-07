import { PublicKey } from "@solana/web3.js";
import { useVaultData } from "../hooks/useVaultData";
import { TokenTag } from "./TokenTag";
import { VAULTS } from "../config";
import idl from "../../../target/idl/pod_vault.json";

const PROGRAM_ID = (idl as any).address as string;

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "how-wrapping-works", label: "How wrapping works" },
  { id: "fees", label: "Fees & where they go" },
  { id: "staking", label: "Staking & rewards" },
  { id: "liquidity", label: "Liquidity & arbitrage" },
  { id: "safety", label: "Safety & admin controls" },
  { id: "how-to", label: "How-to guides" },
  { id: "addresses", label: "Contract addresses" },
  { id: "glossary", label: "Glossary" },
];

// One row of the Contract Addresses table for a single live vault. Every
// address here is derived/fetched client-side (same PDAs the program itself
// uses) rather than hardcoded, so this stays correct if you ever redeploy or
// add more vaults to config.ts.
function VaultAddressRow({ tknMintStr, poolId, name }: { tknMintStr: string; poolId: string | null; name: string }) {
  const d = useVaultData(tknMintStr, poolId);
  const tknMint = new PublicKey(tknMintStr);
  const [vaultConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tknMint.toBuffer()],
    new PublicKey(PROGRAM_ID)
  );

  return (
    <tr>
      <td>{name}</td>
      <td><TokenTag label="TKN" mint={tknMintStr} /></td>
      <td><TokenTag label="bTKN" mint={d.btknMint} /></td>
      <td><TokenTag label="vault" mint={vaultConfig} /></td>
      <td>{poolId ? <TokenTag label="pool" mint={poolId} /> : <span className="muted">not yet</span>}</td>
    </tr>
  );
}

export function Documentation() {
  const liveVaults = VAULTS.filter((v) => v.status === "live" && v.tknMint);

  return (
    <div className="docs-layout">
      <nav className="docs-toc">
        {TOC.map((item) => (
          <a key={item.id} href={`#${item.id}`}>
            {item.label}
          </a>
        ))}
      </nav>

      <div className="docs-content">
        <section id="overview" className="card docs-section">
          <div className="card-head">
            <h2>Overview</h2>
          </div>
          <div className="docs-body">
            <p>
              Monkey Finance is a permissionless wrap vault protocol for Solana tokens. Anyone can wrap an existing
              token (TKN, e.g. a pump.fun launch) into a "pod" that mints a synthetic, vault-backed derivative called
              bTKN. There are two independent ways to earn a share of every fee the vault collects: stake bTKN
              directly (works the moment you've wrapped, no pool required), or, once a bTKN/SOL liquidity pool
              exists, stake that pool's LP token instead. You can do either, both, or neither.
            </p>
            <p>
              Most DeFi yield comes from emissions: new tokens minted and handed out as rewards, which dilutes supply
              and eventually stops working. Monkey Finance's reward pot is instead funded entirely by wrap and unwrap
              fees paid by people moving between TKN and bTKN -- real activity, not inflation. Nothing here depends
              on a separate indexer either: every wrap, unwrap, stake, unstake, claim, and admin action is emitted as
              an on-chain event and reflected directly in the running totals shown on each vault's page.
            </p>
          </div>
        </section>

        <section id="how-wrapping-works" className="card docs-section">
          <div className="card-head">
            <h2>How wrapping works</h2>
          </div>
          <div className="docs-body">
            <p>
              <b>Wrap:</b> deposit TKN, a wrap fee is taken, and bTKN is minted 1:1 against whatever's left. <b>Unwrap:</b>{" "}
              burn bTKN, an unwrap fee is taken, and you receive TKN 1:1 against what's left.
            </p>
            <p>
              Unlike protocols where the wrapped token's backing ratio drifts upward over time, bTKN here is always
              exactly redeemable 1:1 against the vault's held TKN. The fee is paid on top by whoever is wrapping or
              unwrapping -- it's never carved out of the vault's existing backing -- so the peg never dilutes and
              never needs a separate "collateral ratio" to track. What does change over time is TKN's own total
              supply: the burned portion of every fee permanently reduces it, which is deflationary pressure that
              benefits TKN and bTKN holders equally.
            </p>
          </div>
        </section>

        <section id="fees" className="card docs-section">
          <div className="card-head">
            <h2>Fees & where they go</h2>
          </div>
          <div className="docs-body">
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Fee</th>
                  <th>Charged on</th>
                  <th>Cap</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Wrap fee</td>
                  <td>TKN &rarr; bTKN</td>
                  <td>3% max</td>
                </tr>
                <tr>
                  <td>Unwrap fee</td>
                  <td>bTKN &rarr; TKN</td>
                  <td>3% max</td>
                </tr>
                <tr>
                  <td>Burn split</td>
                  <td>share of each fee that's burned outright</td>
                  <td>0-100% of the fee</td>
                </tr>
                <tr>
                  <td>Protocol split</td>
                  <td>share of each fee sent to the vault's protocol wallet</td>
                  <td>0-100% of the fee</td>
                </tr>
                <tr>
                  <td>bTKN staker share</td>
                  <td>share of each fee that goes to bTKN stakers (vs. LP stakers)</td>
                  <td>0-100% of the fee</td>
                </tr>
              </tbody>
            </table>
            <p style={{ marginTop: 14 }}>
              Every fee splits into up to four flat pieces on-chain, each a direct % of the fee itself (not nested):
              a burn portion (permanently destroyed, shrinking TKN's total supply), a protocol-revenue portion sent
              straight to the vault's protocol wallet, a reward portion for bTKN stakers, and a reward portion for
              LP stakers. The burn, protocol, and bTKN-staker shares are each set independently by the authority
              (their sum can never exceed 100% of the fee); whatever's left over automatically goes to LP stakers.
              If nobody is currently staked in a given pool when a fee comes in, that pool's earmarked share is
              burned instead of sitting unclaimable forever -- each pool is topped up independently, so an empty LP
              pool doesn't block bTKN stakers from getting paid, and vice versa. The protocol-revenue share has no
              such fallback since it's a fixed wallet, not a pool of stakers.
            </p>
            <p>
              One thing worth knowing: this only covers wrap/unwrap fees. Ordinary buy/sell activity on the external
              bTKN/SOL pool pays normal AMM swap fees to that pool's liquidity providers directly -- those don't flow
              back into the vault's reward pot, since the pool lives outside this program.
            </p>
          </div>
        </section>

        <section id="staking" className="card docs-section">
          <div className="card-head">
            <h2>Staking & rewards</h2>
          </div>
          <div className="docs-body">
            <p>
              There are two separate staking pools, each funded by its own share of collected fees (see Fees above),
              and each accounted for with its own independent accumulator -- staking in one has no effect on the
              other, and you can participate in either, both, or neither.
            </p>
            <p>
              <b>bTKN staking</b> is the option for holders who don't want to provide liquidity at all: stake bTKN
              directly to earn a share of the bTKN-staker reward pot, proportional to your share of total staked
              bTKN. It works from the moment the vault exists -- no external pool required, since bTKN's mint is
              already known when the vault is created.
            </p>
            <p>
              <b>LP staking:</b> once a vault's authority points it at a live bTKN/SOL LP mint, anyone holding that LP
              token can stake it to start earning a share of the LP-staker reward pot instead, proportional to their
              share of total staked LP.
            </p>
            <p>
              Both pools use the same standard accumulator-based accounting model (rewards proportional to share of
              the pool, counted only from the moment you stake onward), so claiming is O(1) regardless of how many
              stakers there are or how long they've been staked. Staking and unstaking both automatically settle (pay
              out) whatever reward has accrued so far in that pool, so you never lose a pending reward by adjusting
              your position. <code>claim_rewards</code> / <code>claim_btkn_rewards</code> let you collect without
              touching your stake at all. Each account tracks its own lifetime total claimed, so "how much have I
              earned" is always a direct on-chain read, not something you have to reconstruct from history.
            </p>
          </div>
        </section>

        <section id="liquidity" className="card docs-section">
          <div className="card-head">
            <h2>Liquidity & arbitrage</h2>
          </div>
          <div className="docs-body">
            <p>
              Because bTKN always redeems 1:1 for TKN through the vault, that redemption value acts as a natural
              anchor for whatever price bTKN trades at on its external bTKN/SOL pool. If the two drift apart, arbitrage
              pulls them back together:
            </p>
            <p>
              <b>bTKN trading below TKN:</b> buy the discounted bTKN on the pool, unwrap it for TKN at full value, and
              sell that TKN elsewhere -- pocketing the difference (minus the unwrap fee).
            </p>
            <p>
              <b>bTKN trading above TKN:</b> buy TKN on the open market, wrap it into bTKN at 1:1, and sell the newly
              minted bTKN into the pool at the inflated price (minus the wrap fee).
            </p>
            <p>
              Both routes pay a wrap or unwrap fee into the protocol on the way through, so every arbitrage cycle that
              corrects the price also feeds the reward pot and TKN's burn. Depth matters here: a shallow pool means
              small trades swing the price a lot, which invites more (and rougher) arbitrage than a deep one.
            </p>
          </div>
        </section>

        <section id="safety" className="card docs-section">
          <div className="card-head">
            <h2>Safety & admin controls</h2>
          </div>
          <div className="docs-body">
            <p>
              Every admin action is gated to the vault's authority and enforced entirely on-chain -- fee changes can
              never exceed the caps in the table above, no matter what the authority sets. <code>set_paused</code>{" "}
              is an emergency switch that blocks wrap/unwrap only; staking, unstaking, and claiming keep working even
              mid-incident, since letting people access their own funds is always safe.
            </p>
            <p>
              The LP mint can only be set once (<code>set_lp_mint</code>), but if it was set to the wrong address
              before anyone staked, <code>reset_lp_mint</code> allows a one-time correction -- it's blocked entirely
              once <code>total_staked &gt; 0</code>, so it can never be used to strand anyone's stake.{" "}
              Authority transfer is two-step: <code>propose_authority</code> nominates a new key, and
              control only changes hands once that key itself signs <code>accept_authority</code> --
              a mistyped address can never permanently lock the vault, and the current authority can{" "}
              <code>cancel_authority_transfer</code> any time before it's accepted.
            </p>
          </div>
        </section>

        <section id="how-to" className="card docs-section">
          <div className="card-head">
            <h2>How-to guides</h2>
          </div>
          <div className="docs-body">
            <p>
              <b>Wrap TKN &rarr; bTKN:</b> open a vault, choose the Wrap tab under "Your position," enter an amount up
              to your TKN balance, and confirm in your wallet.
            </p>
            <p>
              <b>Unwrap bTKN &rarr; TKN:</b> same panel, Unwrap tab, up to your bTKN balance.
            </p>
            <p>
              <b>Add liquidity:</b> Add LP tab. Enter a bTKN amount -- the matching SOL amount is auto-computed from
              the pool's live reserves (shown as a "~X SOL needed" estimate), and the resulting LP token lands
              straight in your wallet.
            </p>
            <p>
              <b>Remove liquidity:</b> Remove LP tab, same panel as Add LP. Enter an LP amount from your wallet
              balance (not staked) and get bTKN + SOL back proportionally. Unstake first if the LP you want back is
              currently staked.
            </p>
            <p>
              <b>Stake / unstake bTKN:</b> the "Stake bTKN" / "Unstake bTKN" tabs beneath, no pool needed. Works the
              moment you hold bTKN.
            </p>
            <p>
              <b>Stake / unstake LP:</b> the Stake/Unstake tabs beneath the LP section (once a pool + LP mint exist).
              Both this and the bTKN stake/unstake auto-claim any pending reward from that pool as part of the same
              transaction.
            </p>
            <p>
              <b>Claim rewards without unstaking:</b> the two "Claim reward" buttons beneath your position -- one for
              your bTKN stake, one for your LP stake.
            </p>
          </div>
        </section>

        <section id="addresses" className="card docs-section">
          <div className="card-head">
            <h2>Contract addresses</h2>
            <span className="card-hint">click any address to copy</span>
          </div>
          <div className="docs-body">
            <p>
              Program ID: <TokenTag label={PROGRAM_ID.slice(0, 4) + "…" + PROGRAM_ID.slice(-4)} mint={PROGRAM_ID} />
            </p>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Vault</th>
                  <th>TKN</th>
                  <th>bTKN</th>
                  <th>Vault config</th>
                  <th>LP pool</th>
                </tr>
              </thead>
              <tbody>
                {liveVaults.map((v) => (
                  <VaultAddressRow key={v.key} tknMintStr={v.tknMint as string} poolId={v.poolId} name={v.name} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="glossary" className="card docs-section">
          <div className="card-head">
            <h2>Glossary</h2>
          </div>
          <div className="docs-body">
            <table className="docs-table">
              <tbody>
                <tr>
                  <td>TKN</td>
                  <td>The underlying token a vault wraps -- e.g. a pump.fun launch.</td>
                </tr>
                <tr>
                  <td>bTKN</td>
                  <td>The pod's synthetic derivative, minted 1:1 against TKN held in the vault, minus fees.</td>
                </tr>
                <tr>
                  <td>LP token</td>
                  <td>The Meteora liquidity-pool token for the bTKN/SOL pair -- what you actually stake.</td>
                </tr>
                <tr>
                  <td>Reward pot</td>
                  <td>
                    The vault's TKN balance set aside from fees, split between the bTKN-staker pool and the
                    LP-staker pool, paid out over time.
                  </td>
                </tr>
                <tr>
                  <td>Burn split</td>
                  <td>The % of each fee permanently destroyed rather than routed anywhere else.</td>
                </tr>
                <tr>
                  <td>Protocol split</td>
                  <td>The % of each fee sent directly to the vault's protocol wallet.</td>
                </tr>
                <tr>
                  <td>bTKN staker share</td>
                  <td>
                    The % of each fee that goes to the bTKN-staker pool instead of the LP-staker pool. Whatever's
                    left after burn/protocol/bTKN shares are taken out automatically goes to LP stakers.
                  </td>
                </tr>
                <tr>
                  <td>Authority</td>
                  <td>The keypair allowed to change fees, pause the vault, or set/reset its LP mint.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
