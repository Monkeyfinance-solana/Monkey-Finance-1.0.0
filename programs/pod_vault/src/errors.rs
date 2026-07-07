use anchor_lang::prelude::*;

#[error_code]
pub enum PodVaultError {
    #[msg("Fee exceeds maximum allowed (3%)")]
    FeeTooHigh,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Amount too small: fee consumes entire output")]
    AmountBelowFee,
    #[msg("Only the vault authority can perform this action")]
    Unauthorized,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("LP mint has already been set for this vault")]
    LpMintAlreadySet,
    #[msg("Not enough staked to unstake that amount")]
    InsufficientStake,
    #[msg("wrap/unwrap are paused on this vault")]
    VaultPaused,
    #[msg("Cannot reset the LP mint while stakers are still staked")]
    CannotResetWhileStaked,
    #[msg("No LP mint has been set for this vault yet")]
    LpMintNotSet,
    #[msg("New authority cannot be the default/zero pubkey")]
    InvalidNewAuthority,
    #[msg("No authority transfer is currently pending for this vault")]
    NoPendingAuthorityTransfer,
    #[msg("Only the pending authority can accept this transfer")]
    NotThePendingAuthority,
    #[msg("burn_bps + protocol_bps + btkn_share_bps cannot exceed 10_000 (100% of the fee)")]
    FeeSplitExceedsTotal,
    #[msg("protocol_bps is nonzero but no protocol wallet has been set -- call set_protocol_wallet first")]
    ProtocolWalletNotSet,
    #[msg("bTKN name/symbol/uri exceeds Metaplex's max length for that field")]
    MetadataFieldTooLong,
}
