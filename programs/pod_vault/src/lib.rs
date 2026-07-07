use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod events;
pub mod instructions;

use instructions::*;

declare_id!("2A2iyfJ7Fr1PzQiz8crgmGn5MdBcyXaGrffppSz4C5ZD");

#[program]
pub mod pod_vault {
    use super::*;

    /// Creates a new vault ("pod") for a given TKN mint, and creates the
    /// bTKN mint that this vault will control. Call this once per TKN.
    ///
    /// `btkn_name`/`btkn_symbol`/`btkn_uri` become bTKN's own Metaplex
    /// metadata, created atomically in this same instruction (see
    /// `instructions::initialize`). To have bTKN display the same image as
    /// TKN, the caller should fetch TKN's existing metadata off-chain and
    /// pass its `uri` straight through (see `scripts/init_vault.ts`).
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        wrap_fee_bps: u16,
        unwrap_fee_bps: u16,
        burn_bps: u16,
        protocol_bps: u16,
        btkn_share_bps: u16,
        btkn_name: String,
        btkn_symbol: String,
        btkn_uri: String,
    ) -> Result<()> {
        instructions::initialize::handler(
            ctx,
            wrap_fee_bps,
            unwrap_fee_bps,
            burn_bps,
            protocol_bps,
            btkn_share_bps,
            btkn_name,
            btkn_symbol,
            btkn_uri,
        )
    }

    /// Deposit `amount` TKN, receive (amount - fee) bTKN. A share of the
    /// fee (`burn_bps`) is burned; the rest funds staker rewards, split
    /// between LP stakers and bTKN stakers per `btkn_share_bps`.
    pub fn wrap(ctx: Context<Wrap>, amount: u64) -> Result<()> {
        instructions::wrap::handler(ctx, amount)
    }

    /// Burn `amount` bTKN, receive (amount - fee) TKN back. Same fee split
    /// as wrap, using unwrap_fee_bps instead.
    pub fn unwrap(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
        instructions::unwrap::handler(ctx, amount)
    }

    /// Authority-only: change the wrap fee, unwrap fee, and how each fee is
    /// split between burn / protocol revenue / bTKN stakers / LP stakers.
    pub fn update_fees(
        ctx: Context<UpdateFees>,
        wrap_fee_bps: u16,
        unwrap_fee_bps: u16,
        burn_bps: u16,
        protocol_bps: u16,
        btkn_share_bps: u16,
    ) -> Result<()> {
        instructions::admin::update_fees(
            ctx,
            wrap_fee_bps,
            unwrap_fee_bps,
            burn_bps,
            protocol_bps,
            btkn_share_bps,
        )
    }

    /// Authority-only: repoint the protocol-revenue destination account.
    pub fn set_protocol_wallet(ctx: Context<SetProtocolWallet>) -> Result<()> {
        instructions::admin::set_protocol_wallet(ctx)
    }

    /// Authority-only, once per vault: point it at the bTKN/SOL (or
    /// whatever pair) pool's LP mint so LPs can stake it for rewards.
    pub fn set_lp_mint(ctx: Context<SetLpMint>) -> Result<()> {
        instructions::admin::set_lp_mint(ctx)
    }

    /// Authority-only, step 1 of 2: nominate a new authority. Takes no
    /// effect until the nominated address signs `accept_authority`.
    pub fn propose_authority(ctx: Context<ProposeAuthority>) -> Result<()> {
        instructions::admin::propose_authority(ctx)
    }

    /// Step 2 of 2: must be signed by the currently-pending authority.
    /// Completes the transfer nominated by `propose_authority`.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::admin::accept_authority(ctx)
    }

    /// Authority-only: cancels a pending authority transfer before it's
    /// been accepted.
    pub fn cancel_authority_transfer(ctx: Context<CancelAuthorityTransfer>) -> Result<()> {
        instructions::admin::cancel_authority_transfer(ctx)
    }

    /// Authority-only emergency switch: while paused, `wrap` and `unwrap`
    /// are blocked (staking/unstaking/claiming are NOT affected, since
    /// letting people withdraw their own funds is safe even mid-incident).
    /// This buys time to investigate a bug without needing to redeploy.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::admin::set_paused(ctx, paused)
    }

    /// Authority-only, only while total_staked == 0: closes the current
    /// staked-LP vault and clears lp_mint, so `set_lp_mint` can be called
    /// again with a corrected address. Lets you recover from pointing the
    /// vault at the wrong LP mint, as long as nobody's staked yet.
    pub fn reset_lp_mint(ctx: Context<ResetLpMint>) -> Result<()> {
        instructions::admin::reset_lp_mint(ctx)
    }

    /// Stake your bTKN/SOL LP token to start earning a share of fees.
    pub fn stake_lp(ctx: Context<StakeLp>, amount: u64) -> Result<()> {
        instructions::staking::stake_lp(ctx, amount)
    }

    /// Unstake LP tokens, automatically claiming any pending reward first.
    pub fn unstake_lp(ctx: Context<UnstakeLp>, amount: u64) -> Result<()> {
        instructions::staking::unstake_lp(ctx, amount)
    }

    /// Claim accrued rewards without unstaking.
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::staking::claim_rewards(ctx)
    }

    /// Stake bTKN directly to earn a share of fees -- the option for
    /// holders who don't want to provide/stake LP. Works immediately, with
    /// no dependency on an external pool existing.
    pub fn stake_btkn(ctx: Context<StakeBtkn>, amount: u64) -> Result<()> {
        instructions::btkn_staking::stake_btkn(ctx, amount)
    }

    /// Unstake bTKN, automatically claiming any pending reward first.
    pub fn unstake_btkn(ctx: Context<UnstakeBtkn>, amount: u64) -> Result<()> {
        instructions::btkn_staking::unstake_btkn(ctx, amount)
    }

    /// Claim accrued bTKN-staking rewards without unstaking.
    pub fn claim_btkn_rewards(ctx: Context<ClaimBtknRewards>) -> Result<()> {
        instructions::btkn_staking::claim_btkn_rewards(ctx)
    }
}
