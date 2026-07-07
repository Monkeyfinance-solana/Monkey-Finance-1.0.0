# pod_vault -- internal pre-audit review

Manual review of `programs/pod_vault/src/*` (the on-chain Anchor program) ahead of
pushing to GitHub for external review/audit. This is **not a substitute for a
real, professional security audit** (see task #25 in the project backlog) --
treat it as a pre-audit pass that should make an external reviewer's job
faster, not a replacement for one. Do not use this program with real funds
until it has had a proper audit.

Severity labels are relative to this project's stated goal (a permissionless
wrap/unwrap vault handling real user deposits on mainnet).

This is the second pass. All five numbered findings from the first pass have
been triaged by the project owner and are now either fixed or explicitly
accepted as a known tradeoff -- see each item below for the resolution.

---

## Resolved

### 1. `initialize_vault` is permissionless with no relationship-to-mint check -- accepted, not a bug
`vault_config` is a PDA derived solely from `tkn_mint`. Anyone can call
`initialize_vault` for any TKN mint and become its permanent authority, with
no check that the caller has any relationship to the mint.

**Resolution: accepted as-is.** The project owner's reasoning, confirmed
correct: this is only a concern if an attacker-initialized vault could ever
be presented to end users as if it were the legitimate one. It can't --
end users only ever interact with vaults the front end explicitly lists
(`app/src/config.ts`), and that list is controlled by the project, not by
whatever's initializable on-chain. Someone copy-pasting the repo and
initializing a vault for an unrelated mint produces a vault nobody's front
end points at, which is no different from anyone deploying their own copy of
the whole program under their own program ID. The actual risk is narrower
than originally framed: it's a denial-of-service against the *project's own*
ability to grab a clean vault PDA for one specific pre-existing mint they
don't control the initialization of yet -- trivially worked around by using a
fresh mint, and irrelevant to end-user fund safety. No code change made.

### 2. `update_authority` was single-step, immediate, and unvalidated -- fixed
Authority transfer used to take effect immediately on a single signed
instruction from the current authority, with no acceptance step and no
validation that `new_authority` was reachable. A mistyped address
permanently and irrecoverably stripped control of the vault.

**Fix:** replaced the single `update_authority` instruction with a two-step
flow:
- `propose_authority` (current-authority-only) sets `pending_authority` on
  `VaultConfig`. Nothing takes effect yet. Rejects `Pubkey::default()` as the
  proposed address.
- `accept_authority`, which must be signed by the pending authority itself,
  flips `authority` over and clears `pending_authority`. A typo'd or
  unreachable address just sits as an inert, un-acceptable proposal -- the
  current authority retains full control (including the ability to propose
  again, or cancel) until the correct address actively accepts.
- `cancel_authority_transfer` (current-authority-only) clears a pending
  proposal before it's accepted, e.g. to correct a mistake.

New fields/errors/events: `VaultConfig.pending_authority: Pubkey` (LEN +32),
`PodVaultError::InvalidNewAuthority` / `NoPendingAuthorityTransfer` /
`NotThePendingAuthority`, `AuthorityProposedEvent` /
`AuthorityTransferCancelledEvent` (new), `AuthorityUpdatedEvent` (kept,
now emitted from `accept_authority`). `tests/pod_vault.ts` rewritten to cover
propose -> accept, propose -> cancel, and rejecting both a default-pubkey
proposal and an accept from a non-pending signer.

### 3. No timelock on fee/pause changes -- fee cap tightened, rest accepted
`update_fees` could move `wrap_fee_bps`/`unwrap_fee_bps` up to 10% instantly,
with `set_paused` similarly instant. The project owner does not expect large
fee events and accepts the remaining lack of a timelock as-is; this remains
disclosed as a design tradeoff (the authority key is a single point of trust
for pricing and availability) for the eventual external auditor.

**Fix applied:** `VaultConfig::MAX_FEE_BPS` reduced from `1000` (10%) to
`300` (3%) -- this is a hard on-chain cap, not just a front-end suggestion, so
`wrap_fee_bps`/`unwrap_fee_bps` can now never exceed 3% regardless of what the
authority sets. `PodVaultError::FeeTooHigh`'s message updated to match.
`burn_bps`/`btkn_share_bps` caps (100% of their respective bases) are
unchanged -- those aren't fees on the user, they're splits of an already-capped
fee.

---

## Accepted risk (no code change)

### 4. Just-in-time stake/unstake around a large fee event
Reward accounting is correctly keyed off internal `total_staked`/
`total_btkn_staked` counters (donation-attack-resistant), but nothing stops
someone from staking immediately before a large fee lands and unstaking
right after, capturing a pro-rata share without providing meaningful
duration of commitment. Mathematically fair (no theft from others), just a
yield-dilution nuisance for genuine long-term stakers.

**Resolution: accepted, not a concern.** The project owner does not expect
large, discrete fee events in practice, so the JIT-capture window is
expected to stay small in absolute terms. The planned lock-multiplier
staking feature (task #29) remains a natural future mitigation if this
changes.

---

## Resolved (low severity / defense-in-depth)

### 5. Inconsistent owner constraints on user token accounts -- fixed
`unwrap.rs`'s `user_btkn_account` had an explicit
`constraint = user_btkn_account.owner == user.key()`; the equivalent source
accounts elsewhere did not. Not exploitable (the underlying SPL Token CPI
itself enforces owner == signing authority), but inconsistent.

**Fix:** added the explicit owner constraint to every remaining
user-controlled token account across the program, for consistency and to
stop relying on the implicit CPI-level guarantee:
- `wrap.rs`: `user_tkn_account`
- `instructions/staking.rs`: `user_lp_token_account` and
  `user_reward_token_account` (in `StakeLp`, `UnstakeLp`, and
  `ClaimRewards`)
- `instructions/btkn_staking.rs`: `user_btkn_account` and
  `user_reward_token_account` (in `StakeBtkn`, `UnstakeBtkn`, and
  `ClaimBtknRewards`)

---

## Informational / repo hygiene

- `programs/pod_vault/src/instructions/increment.rs`,
  `programs/pod_vault/src/error.rs`, and `programs/pod_vault/src/constants.rs`
  are confirmed dead (never declared in `instructions/mod.rs` or `lib.rs`;
  `constants.rs`'s `#[constant]`-tagged values were leaking into the IDL for
  no reason). **These are flagged for deletion but not yet removed from the
  working tree** -- the automated shell tool in this session is currently
  unable to run `rm`/`git rm` (an unrelated environment issue), so the
  actual deletion needs to be run manually:
  ```
  git rm programs/pod_vault/src/instructions/increment.rs \
         programs/pod_vault/src/error.rs \
         programs/pod_vault/src/constants.rs
  ```
  None of the three are referenced anywhere, so removing them has zero
  build impact.
- The front-end AMM integration (Raydium, then Meteora) has already had two
  real, distinct bugs caught during local testing this session: a
  mintA/mintB canonical-ordering assumption causing a 100x over-withdrawal on
  Add LP, and a wrong fee-denominator assumption on Meteora pool creation.
  Neither is in the on-chain program, but it's a signal that the
  `useVaultData.ts`/AMM-integration layer deserves the same level of
  scrutiny as the program itself before real funds flow through it.

---

## What's already solid (so a reviewer doesn't need to re-derive this)

- Checked arithmetic (`checked_add`/`checked_sub`/`checked_mul`) used
  consistently for every balance-affecting calculation, on top of
  `overflow-checks = true` in `Cargo.toml`'s release profile as a backstop.
- Reward accounting uses the internal `total_staked`/`total_btkn_staked`
  counters, not raw token-account balances -- a direct SPL transfer
  ("donation") into `reward_vault_token_account` can't be double-counted into
  anyone's claimable rewards; at worst it becomes unclaimable dust.
- The `burn_amount + lp_reward_amount + btkn_reward_amount == fee` invariant
  holds by construction in both `wrap.rs` and `unwrap.rs`, including the
  independent zero-staked-pool redirect-to-burn fallback for each pool.
- `pause` only blocks `wrap`/`unwrap`; staking, unstaking, and claiming
  remain available even mid-incident, so users can always exit their own
  positions.
- `reset_lp_mint` is correctly gated on `total_staked == 0`, so it's
  impossible to strand anyone's staked LP.
- All PDA seeds are properly bound and checked via `seeds`/`bump`/`has_one`
  constraints; no account-substitution paths were found.
- Division-by-zero on the reward-accumulator update is structurally
  prevented -- the zero-staked-pool case is redirected to burn *before* the
  division that would otherwise divide by zero.
- Authority transfer is now two-step and cannot be bricked by a typo (see
  finding #2 above).
- Every user-supplied token account across every instruction now has both a
  mint constraint and an owner constraint (see finding #5 above).
