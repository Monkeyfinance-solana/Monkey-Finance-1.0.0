use anchor_lang::prelude::*;

// Every event carries a unix timestamp so an off-chain indexer can bucket
// them into time windows (e.g. to compute a trailing-24h/7d APY). Cumulative
// stats like TVL, total burned, and total claimed don't need events at all --
// they're plain fields on VaultConfig/StakeInfo, readable with a single
// account fetch. Events exist for things that are inherently about *rate*
// or *history* rather than a running total.

#[event]
pub struct WrapEvent {
    pub vault_config: Pubkey,
    pub user: Pubkey,
    pub amount_in: u64,
    pub fee: u64,
    pub burned: u64,
    pub to_protocol: u64,
    pub to_reward_pot: u64,
    pub to_btkn_reward_pot: u64,
    pub btkn_minted: u64,
    pub timestamp: i64,
}

#[event]
pub struct UnwrapEvent {
    pub vault_config: Pubkey,
    pub user: Pubkey,
    pub btkn_burned: u64,
    pub fee: u64,
    pub burned: u64,
    pub to_protocol: u64,
    pub to_reward_pot: u64,
    pub to_btkn_reward_pot: u64,
    pub tkn_released: u64,
    pub timestamp: i64,
}

#[event]
pub struct StakeEvent {
    pub vault_config: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub total_staked: u64,
    pub timestamp: i64,
}

#[event]
pub struct UnstakeEvent {
    pub vault_config: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub total_staked: u64,
    pub timestamp: i64,
}

/// Emitted any time a pending reward is actually paid out -- whether that
/// happened via an explicit `claim_rewards` call, or as the automatic
/// settle-before-you-change-your-stake step inside `stake_lp`/`unstake_lp`.
#[event]
pub struct RewardPaidEvent {
    pub vault_config: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

/// Same shape as StakeEvent/UnstakeEvent/RewardPaidEvent, emitted for the
/// bTKN-staker pool instead of the LP-staker pool.
#[event]
pub struct BtknStakeEvent {
    pub vault_config: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub total_btkn_staked: u64,
    pub timestamp: i64,
}

#[event]
pub struct BtknUnstakeEvent {
    pub vault_config: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub total_btkn_staked: u64,
    pub timestamp: i64,
}

#[event]
pub struct BtknRewardPaidEvent {
    pub vault_config: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct FeesUpdatedEvent {
    pub vault_config: Pubkey,
    pub wrap_fee_bps: u16,
    pub unwrap_fee_bps: u16,
    pub burn_bps: u16,
    pub protocol_bps: u16,
    pub btkn_share_bps: u16,
    pub timestamp: i64,
}

/// Emitted whenever the protocol-revenue destination account is set/changed
/// via `set_protocol_wallet`.
#[event]
pub struct ProtocolWalletSetEvent {
    pub vault_config: Pubkey,
    pub protocol_token_account: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PausedSetEvent {
    pub vault_config: Pubkey,
    pub paused: bool,
    pub timestamp: i64,
}

#[event]
pub struct LpMintSetEvent {
    pub vault_config: Pubkey,
    pub lp_mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct LpMintResetEvent {
    pub vault_config: Pubkey,
    pub timestamp: i64,
}

/// Emitted when the authority proposes a transfer via `propose_authority`.
/// The transfer isn't in effect yet -- `authority` on VaultConfig is
/// unchanged until the proposed address calls `accept_authority`.
#[event]
pub struct AuthorityProposedEvent {
    pub vault_config: Pubkey,
    pub current_authority: Pubkey,
    pub proposed_authority: Pubkey,
    pub timestamp: i64,
}

/// Emitted when a pending authority transfer is cancelled via
/// `cancel_authority_transfer`, before it was ever accepted.
#[event]
pub struct AuthorityTransferCancelledEvent {
    pub vault_config: Pubkey,
    pub cancelled_pending_authority: Pubkey,
    pub timestamp: i64,
}

/// Emitted once the proposed authority actually accepts, via
/// `accept_authority` -- this is the point the transfer takes effect.
#[event]
pub struct AuthorityUpdatedEvent {
    pub vault_config: Pubkey,
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub timestamp: i64,
}
