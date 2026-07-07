use anchor_lang::prelude::*;

#[account]
pub struct VaultConfig {
    pub authority: Pubkey,
    /// Set by `propose_authority`, cleared by `accept_authority` or
    /// `cancel_authority_transfer`. Pubkey::default() means "no transfer
    /// pending". Two-step so a mistyped/unreachable address can never
    /// permanently strip control of the vault -- the new authority must
    /// actively sign `accept_authority` before the change takes effect.
    pub pending_authority: Pubkey,
    pub tkn_mint: Pubkey,
    pub btkn_mint: Pubkey,
    pub vault_token_account: Pubkey,
    /// Holds the LP-reward share of collected fees until stakers claim it.
    pub reward_vault_token_account: Pubkey,
    /// The bTKN/SOL (or whatever pair) LP token from an external AMM.
    /// Pubkey::default() until `set_lp_mint` is called, since the pool
    /// is usually created after the vault itself.
    pub lp_mint: Pubkey,
    /// Holds staked LP tokens in custody. Pubkey::default() until
    /// `set_lp_mint` is called.
    pub staked_lp_vault: Pubkey,
    /// Holds staked bTKN tokens in custody. Created at `initialize_vault`
    /// time (unlike staked_lp_vault) since the bTKN mint is already known
    /// up front -- bTKN staking has no external-pool dependency, so it can
    /// be used the moment someone wraps, with no bootstrap step.
    pub staked_btkn_vault: Pubkey,
    /// Destination for the protocol-revenue share of each fee (see
    /// `protocol_bps`). A plain TokenAccount (TKN mint) that the team
    /// controls -- e.g. an ATA of the vault deployer's own wallet. Set at
    /// `initialize_vault` time and changeable later via `set_protocol_wallet`.
    pub protocol_token_account: Pubkey,
    pub wrap_fee_bps: u16,
    pub unwrap_fee_bps: u16,
    /// Every one of burn_bps/protocol_bps/btkn_share_bps below is a direct
    /// % *of the fee itself* (not nested/sequential -- e.g. burn_bps = 2000
    /// means 20% of the fee is burned, independent of the other splits).
    /// Their sum must be <= 10_000; whatever's left over implicitly goes to
    /// the LP-staker reward pot, so the four buckets (burn, protocol, bTKN
    /// stakers, LP stakers) always account for exactly 100% of the fee.
    ///
    /// % of each collected fee that gets burned.
    pub burn_bps: u16,
    /// % of each collected fee routed to `protocol_token_account`. Requires
    /// `protocol_token_account` to already be set -- see `set_protocol_wallet`.
    pub protocol_bps: u16,
    /// % of each collected fee that goes to the bTKN-staker reward pot
    /// (rather than the LP-staker reward pot). Orthogonal to burn_bps/
    /// protocol_bps.
    pub btkn_share_bps: u16,
    /// Accumulator (scaled by SCALE) used for O(1) reward accounting,
    /// MasterChef-style: each staker's pending reward is
    /// `amount * acc_reward_per_share / SCALE - reward_debt`.
    pub acc_reward_per_share: u128,
    /// Same idea as acc_reward_per_share, but for the bTKN-staker pool.
    pub acc_btkn_reward_per_share: u128,
    pub total_staked: u64,
    /// Total bTKN currently staked (locked in staked_btkn_vault).
    pub total_btkn_staked: u64,
    pub total_wrapped: u64,
    pub total_unwrapped: u64,
    /// Cumulative TKN burned by this vault since inception. Read this
    /// directly (no indexer needed) for a "total burned" stat.
    pub total_burned: u64,
    /// Cumulative TKN ever routed into the LP-staker reward pot (whether
    /// claimed yet or not).
    pub total_reward_distributed: u64,
    /// Same, for the bTKN-staker reward pot.
    pub total_btkn_reward_distributed: u64,
    /// Cumulative TKN ever sent to `protocol_token_account`.
    pub total_protocol_distributed: u64,
    pub bump: u8,
    pub btkn_mint_bump: u8,
    /// Emergency switch. While true, `wrap`/`unwrap` are blocked. Does NOT
    /// affect staking/unstaking/claiming -- letting people withdraw their
    /// own funds is safe even mid-incident.
    pub paused: bool,
}

impl VaultConfig {
    /// Hard cap so the authority can never set an abusive wrap/unwrap fee: 300 bps = 3%.
    pub const MAX_FEE_BPS: u16 = 300;
    /// Each of these three is individually capped at 100% of the fee, but
    /// the real enforcement is their *sum* <= MAX_BASIS_POINT, checked in
    /// `update_fees`/`initialize_vault` -- see the field docs above.
    pub const MAX_BURN_BPS: u16 = 10_000;
    pub const MAX_PROTOCOL_BPS: u16 = 10_000;
    pub const MAX_BTKN_SHARE_BPS: u16 = 10_000;
    /// burn_bps + protocol_bps + btkn_share_bps must never exceed this --
    /// 100% of the fee. Whatever's unclaimed by those three implicitly goes
    /// to LP stakers.
    pub const MAX_BASIS_POINT: u16 = 10_000;

    pub const LEN: usize = 8 // discriminator
        + 32 * 10 // authority, pending_authority, tkn_mint, btkn_mint,
                  // vault_token_account, reward_vault_token_account, lp_mint,
                  // staked_lp_vault, staked_btkn_vault, protocol_token_account
        + 2 * 5   // wrap_fee_bps, unwrap_fee_bps, burn_bps, protocol_bps,
                  // btkn_share_bps
        + 16 * 2  // acc_reward_per_share, acc_btkn_reward_per_share (u128)
        + 8 * 8   // total_staked, total_btkn_staked, total_wrapped,
                  // total_unwrapped, total_burned, total_reward_distributed,
                  // total_btkn_reward_distributed, total_protocol_distributed
        + 1 * 2   // bump, btkn_mint_bump
        + 1;      // paused
}

/// Shared shape for both staking pools: LP stakers (PDA seeds `["stake", ...]`)
/// and bTKN stakers (PDA seeds `["btkn_stake", ...]`) each get their own
/// StakeInfo account, keyed by their own seed prefix, pointed at their own
/// accumulator on VaultConfig.
#[account]
pub struct StakeInfo {
    pub owner: Pubkey,
    pub vault_config: Pubkey,
    pub amount: u64,
    pub reward_debt: u128,
    pub bump: u8,
    /// Cumulative TKN this staker has ever been paid, across every
    /// stake/unstake/claim that triggered a payout. Read this directly to
    /// answer "how much have I gained so far" without needing to replay
    /// event history.
    pub total_claimed: u64,
}

impl StakeInfo {
    pub const LEN: usize = 8 // discriminator
        + 32 // owner
        + 32 // vault_config
        + 8  // amount
        + 16 // reward_debt
        + 1  // bump
        + 8; // total_claimed
}
