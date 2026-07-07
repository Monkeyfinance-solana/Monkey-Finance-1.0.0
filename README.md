# pod_vault

A Peapod-style wrap/unwrap vault for a single Solana token (TKN), built with
Anchor. Users deposit TKN and receive bTKN 1:1 minus a fee; burning bTKN
releases TKN 1:1 minus a fee. A share of each fee is burned (deflationary
pressure on TKN), and the rest funds rewards for people staking the
bTKN/SOL LP token. No Ethereum, no bridging -- everything happens on Solana.

## How it fits your flow

1. Launch TKN on pump.fun. You get back a mint address.
2. Deploy this program and call `initialize_vault` once, passing that TKN
   mint address, your wrap/unwrap fees, and how much of each fee gets burned
   vs. routed to LP-staking rewards (all in basis points). This creates:
   - a `vault_config` PDA (the pod's settings/state)
   - a `btkn_mint` PDA-controlled mint (only this program can mint it)
   - a `vault_token_account` (PDA-owned, holds deposited TKN 1:1 against bTKN)
   - a `reward_vault_token_account` (PDA-owned, holds the LP-reward share of
     fees until stakers claim it)
3. Users call `wrap` to deposit TKN and receive bTKN, or `unwrap` to burn
   bTKN and get TKN back. Both take the configured fee, split between burn
   and the reward pot.
4. Separately, create a bTKN/SOL pool on whatever AMM you like (Raydium,
   Meteora, etc.) -- that part is outside this program entirely.
5. Once that pool exists, call `set_lp_mint` once to point the vault at the
   pool's LP mint. LPs can then call `stake_lp` to start earning a share of
   every fee collected, `claim_rewards` to collect without unstaking, and
   `unstake_lp` to withdraw (auto-claiming first).

If nobody has staked yet (`total_staked == 0`), 100% of every fee is burned
instead of sitting unclaimable in the reward pot -- see `wrap.rs`/`unwrap.rs`.

## Design

- **Invariant:** `vault_token_account` balance always exactly equals bTKN
  circulating supply. Fee proceeds never touch this account -- they're
  routed to burn or to `reward_vault_token_account` at the moment of the
  swap -- so the vault can never become under-collateralized.
- **Mint authority:** the `vault_config` PDA is the bTKN mint authority
  (via seeds `[b"vault", tkn_mint]`), so only this program's `wrap`
  instruction can ever create new bTKN.
- **Burning as a fee mechanic:** burning an SPL token only requires the
  token *account* owner/authority to sign -- not the mint authority. That's
  why this vault can burn TKN (a token it doesn't control the mint of, since
  pump.fun keeps that) as long as it holds tokens in an account it owns.
- **Reward accounting:** MasterChef/Synthetix-style accumulator
  (`acc_reward_per_share`, scaled by 1e12) so reward distribution is O(1)
  regardless of how many people are staked. Each staker's pending reward is
  `stake.amount * acc_reward_per_share / SCALE - stake.reward_debt`, settled
  and checkpointed whenever they stake, unstake, or claim.
- **Fee caps:** wrap/unwrap fees are capped at 3% (`MAX_FEE_BPS`). Each fee
  then splits four ways, each a flat % *of the fee itself* (not nested):
  `burn_bps` (destroyed), `protocol_bps` (sent to `protocol_token_account`,
  e.g. the team's own wallet), `btkn_share_bps` (bTKN-staker reward pot), and
  whatever's left implicitly goes to the LP-staker reward pot.
  `burn_bps + protocol_bps + btkn_share_bps` can never exceed 100%
  (`MAX_BASIS_POINT`), enforced on both `initialize_vault` and `update_fees`.
- **Admin controls:** `update_fees`, `set_lp_mint`, `propose_authority`,
  `cancel_authority_transfer`, `set_paused`, and `reset_lp_mint` are all
  gated by `has_one = authority`, checked against the `vault_config` account
  itself (not a separate hardcoded pubkey). Authority transfer is two-step:
  `propose_authority` nominates a new authority, and only that address's own
  `accept_authority` signature actually completes the transfer.
- **Emergency pause:** `set_paused(true)` blocks `wrap`/`unwrap` immediately
  if a bug is found post-deploy, without needing to redeploy the program.
  Staking/unstaking/claiming are deliberately unaffected by the pause --
  letting people withdraw their own funds is safe even mid-incident. To
  actually *fix* a bug (not just pause it), redeploy the program to the same
  address with `anchor deploy` -- Anchor programs are upgradeable by default,
  so this replaces the code in place without touching any existing accounts
  or balances.
- **Recovering from a wrong LP mint:** `set_lp_mint` can normally only be
  called once. If you set it to the wrong address, `reset_lp_mint` lets the
  authority undo it and call `set_lp_mint` again -- but ONLY while
  `total_staked == 0`. Once someone's staked, the vault's own invariant
  guarantees the LP mint can never be changed out from under them.
- **On-chain stats, no indexer required:** `VaultConfig` tracks running
  totals (`total_wrapped`, `total_unwrapped`, `total_burned`,
  `total_reward_distributed`) and `StakeInfo` tracks `total_claimed` per
  staker. TVL is just the live `vault_token_account` balance. That covers
  TVL, cumulative burned, and "how much have I gained so far" with a single
  account fetch each -- no event replay needed. The one thing that
  genuinely needs history is APY, since it's a rate, not a running total --
  see Events below.
- **Events:** every instruction that changes something meaningful emits an
  Anchor event (`WrapEvent`, `UnwrapEvent`, `StakeEvent`, `UnstakeEvent`,
  `RewardPaidEvent`, plus admin events for fee/LP-mint/pause/authority
  changes). `RewardPaidEvent` fires from the shared `settle_and_pay` helper,
  so it fires consistently whether a payout was triggered by an explicit
  `claim_rewards` or an automatic settle inside `stake_lp`/`unstake_lp`.
  These are what a front-end/indexer would subscribe to (or backfill via
  `getSignaturesForAddress`) to compute time-windowed stats like APY --
  sum the `RewardPaidEvent`/reward-pot inflow amounts over a trailing
  window (e.g. 7 days) and annualize against current `total_staked`.

## Files

```
pod_vault/
  Anchor.toml
  Cargo.toml
  programs/pod_vault/
    Cargo.toml
    src/
      lib.rs              -- program entrypoints
      state.rs             -- VaultConfig, StakeInfo accounts
      errors.rs             -- custom error codes
      events.rs             -- WrapEvent / UnwrapEvent / StakeEvent / UnstakeEvent / RewardPaidEvent / admin events
      instructions/
        initialize.rs      -- initialize_vault (also CPIs into Metaplex to create bTKN's metadata, mirroring TKN's)
        wrap.rs             -- wrap (deposit TKN, mint bTKN, burn/reward fee split)
        unwrap.rs           -- unwrap (burn bTKN, release TKN, burn/reward fee split)
        admin.rs            -- update_fees / set_lp_mint / propose_authority / accept_authority / cancel_authority_transfer / set_paused / reset_lp_mint
        staking.rs           -- stake_lp / unstake_lp / claim_rewards
  tests/
    pod_vault.ts           -- full wrap/unwrap/fee/staking/auth test suite
```

## Setup

Requires: Rust (>= 1.89, check with `rustc --version`, update with `rustup update`),
Solana CLI 3.x / Agave, Anchor CLI 1.x (via `avm`), Node/npm.

```bash
# install anchor 1.1.2 if you don't have it
avm install 1.1.2
avm use 1.1.2

npm install
anchor build
anchor test --validator legacy   # uses your existing solana-test-validator
```

Anchor 1.x defaults `anchor test`/`anchor localnet` to a tool called Surfpool
instead of `solana-test-validator`. Since you already have the Solana CLI
installed, `--validator legacy` skips installing Surfpool and uses the
validator you've already got. Drop the flag later if you'd rather install
Surfpool (see the Anchor 1.0 release notes for that).

`initialize_vault` now CPIs into the Metaplex Token Metadata program to
create bTKN's on-chain metadata, so your local validator must have that
program cloned onto it -- this is no longer just a Meteora-pool-tests
requirement, every vault initialization (including the very first test)
needs it now. Run `npx ts-node scripts/print_meteora_clone_cmd.ts` for the
exact `solana-test-validator --clone-upgradeable-program ...` command
(it already includes the Metaplex program alongside Meteora's).

Note: the Anchor TypeScript client package was renamed from `@coral-xyz/anchor`
to `@anchor-lang/core` in the 1.0 release -- this scaffold already uses the
new name.

The program ID in `Anchor.toml` and `declare_id!` is a placeholder
(`Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS`, the standard Anchor example
ID -- valid enough to build, but you don't control its keypair). Before
deploying anywhere real:

```bash
anchor keys list          # generates/shows the real keypair-derived program id
anchor keys sync          # writes it into Anchor.toml and lib.rs's declare_id!()
anchor build
anchor deploy --provider.cluster devnet   # or mainnet, once you're confident
```

## Calling it from a client

Once your TKN mint address exists (from pump.fun), initialize the vault:

```ts
await program.methods
  .initializeVault(
    75, 125, 3000, 1000, 5000,       // 0.75% wrap / 1.25% unwrap fee; of each fee: 30% burn, 10% protocol, 50% bTKN stakers (remainder to LP stakers)
    btknName, btknSymbol, btknUri    // bTKN's Metaplex metadata -- fetch TKN's existing metadata off-chain and forward its uri to mirror TKN's image (see scripts/init_vault.ts)
  )
  .accountsPartial({
    authority: wallet.publicKey,
    tknMint,                        // your pump.fun TKN mint
    protocolTokenAccount,           // must already exist and hold TKN
    vaultConfig,                    // PDA: ["vault", tknMint]
    btknMint,                       // PDA: ["btkn_mint", tknMint]
    vaultTokenAccount,              // PDA: ["vault_tkn", tknMint]
    rewardVaultTokenAccount,        // PDA: ["reward_vault", tknMint]
    stakedBtknVault,                // PDA: ["staked_btkn", tknMint]
    btknMetadata,                   // PDA: ["metadata", METADATA_PROGRAM_ID, btknMint], owned by METADATA_PROGRAM_ID
    tokenMetadataProgram: METADATA_PROGRAM_ID, // metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s
    sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

Once your bTKN/SOL pool exists on whatever AMM you chose, point the vault at
its LP mint and let people stake it:

```ts
await program.methods
  .setLpMint()
  .accountsPartial({ authority: wallet.publicKey, vaultConfig, lpMint, stakedLpVault, ... })
  .rpc();

await program.methods
  .stakeLp(new anchor.BN(amount))
  .accountsPartial({ user: staker.publicKey, vaultConfig, lpMint, stakedLpVault, rewardVaultTokenAccount, userLpTokenAccount, userRewardTokenAccount, stakeInfo, ... })
  .rpc();
```

See `tests/pod_vault.ts` for a complete, working example of every
instruction (initialize, wrap, unwrap, set_lp_mint, stake_lp, claim_rewards,
update_fees) end to end, and `scripts/` (init_vault.ts, test_wrap_unwrap.ts,
stake_and_earn.ts) for standalone scripts you can run against a live
validator.

## Before mainnet: things worth doing that aren't in this scaffold

- Get the program properly audited -- this is unaudited example code.
- If TKN could ever have a transfer fee or be a Token-2022 mint, the transfer
  amounts in `wrap`/`unwrap` need adjusting -- this scaffold assumes a plain
  SPL Token (Token Program, not Token-2022).
- No real Raydium/Orca CPI integration -- `set_lp_mint` just takes whatever
  mint you pass it. `reset_lp_mint` gives you a way to correct a mistake, but
  only before anyone's staked -- double-check it's the right pool's LP mint.
- Still no timelock on `update_fees` (takes effect instantly). Authority
  transfer, however, now is two-step (`propose_authority` /
  `accept_authority`), so a mistyped new-authority pubkey is no longer
  unrecoverable.
- No on-chain minimum stake duration / unstake cooldown, so in principle
  someone could stake right before a known large fee event and unstake
  right after, capturing a disproportionate share. Not a concern at your
  current scale, worth revisiting if staked value grows large relative to
  typical fee events.
