use anchor_lang::prelude::*;
use anchor_lang::Id;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount};

use crate::errors::PodVaultError;
use crate::events::{
    AuthorityProposedEvent, AuthorityTransferCancelledEvent, AuthorityUpdatedEvent,
    FeesUpdatedEvent, LpMintResetEvent, LpMintSetEvent, PausedSetEvent, ProtocolWalletSetEvent,
};
use crate::state::VaultConfig;

#[derive(Accounts)]
pub struct UpdateFees<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = authority @ PodVaultError::Unauthorized,
    )]
    pub vault_config: Account<'info, VaultConfig>,
}

pub fn update_fees(
    ctx: Context<UpdateFees>,
    wrap_fee_bps: u16,
    unwrap_fee_bps: u16,
    burn_bps: u16,
    protocol_bps: u16,
    btkn_share_bps: u16,
) -> Result<()> {
    require!(wrap_fee_bps <= VaultConfig::MAX_FEE_BPS, PodVaultError::FeeTooHigh);
    require!(unwrap_fee_bps <= VaultConfig::MAX_FEE_BPS, PodVaultError::FeeTooHigh);
    require!(burn_bps <= VaultConfig::MAX_BURN_BPS, PodVaultError::FeeTooHigh);
    require!(protocol_bps <= VaultConfig::MAX_PROTOCOL_BPS, PodVaultError::FeeTooHigh);
    require!(
        btkn_share_bps <= VaultConfig::MAX_BTKN_SHARE_BPS,
        PodVaultError::FeeTooHigh
    );
    let split_total = (burn_bps as u32) + (protocol_bps as u32) + (btkn_share_bps as u32);
    require!(
        split_total <= VaultConfig::MAX_BASIS_POINT as u32,
        PodVaultError::FeeSplitExceedsTotal
    );
    require!(
        protocol_bps == 0
            || ctx.accounts.vault_config.protocol_token_account != Pubkey::default(),
        PodVaultError::ProtocolWalletNotSet
    );

    let vault_config = &mut ctx.accounts.vault_config;
    vault_config.wrap_fee_bps = wrap_fee_bps;
    vault_config.unwrap_fee_bps = unwrap_fee_bps;
    vault_config.burn_bps = burn_bps;
    vault_config.protocol_bps = protocol_bps;
    vault_config.btkn_share_bps = btkn_share_bps;

    emit!(FeesUpdatedEvent {
        vault_config: ctx.accounts.vault_config.key(),
        wrap_fee_bps,
        unwrap_fee_bps,
        burn_bps,
        protocol_bps,
        btkn_share_bps,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Lets the authority repoint the protocol-revenue destination to a
/// different TokenAccount (e.g. if the original wallet is compromised or
/// they just want to route revenue somewhere else). Always requires a valid
/// TKN-mint TokenAccount -- there's no "unset" path, since `initialize_vault`
/// already requires one up front.
#[derive(Accounts)]
pub struct SetProtocolWallet<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = authority @ PodVaultError::Unauthorized,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(constraint = protocol_token_account.mint == vault_config.tkn_mint)]
    pub protocol_token_account: Account<'info, TokenAccount>,
}

pub fn set_protocol_wallet(ctx: Context<SetProtocolWallet>) -> Result<()> {
    ctx.accounts.vault_config.protocol_token_account = ctx.accounts.protocol_token_account.key();

    emit!(ProtocolWalletSetEvent {
        vault_config: ctx.accounts.vault_config.key(),
        protocol_token_account: ctx.accounts.protocol_token_account.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Called once, after the bTKN/SOL (or whatever pair) pool exists on
/// whatever AMM you used, to point the vault at that pool's LP mint so
/// LPs can start staking it for a share of fee revenue.
#[derive(Accounts)]
pub struct SetLpMint<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = authority @ PodVaultError::Unauthorized,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub lp_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        seeds = [b"staked_lp", vault_config.key().as_ref()],
        bump,
        token::mint = lp_mint,
        token::authority = vault_config,
    )]
    pub staked_lp_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn set_lp_mint(ctx: Context<SetLpMint>) -> Result<()> {
    require!(
        ctx.accounts.vault_config.lp_mint == Pubkey::default(),
        PodVaultError::LpMintAlreadySet
    );
    let vault_config = &mut ctx.accounts.vault_config;
    vault_config.lp_mint = ctx.accounts.lp_mint.key();
    vault_config.staked_lp_vault = ctx.accounts.staked_lp_vault.key();

    emit!(LpMintSetEvent {
        vault_config: ctx.accounts.vault_config.key(),
        lp_mint: ctx.accounts.lp_mint.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Step 1 of 2 for a authority transfer: the current authority nominates a
/// new one. Nothing takes effect yet -- `vault_config.authority` is
/// unchanged until the nominated address signs `accept_authority`. This
/// means a mistyped or unreachable `new_authority` is harmless: it just sits
/// as an un-acceptable pending proposal, and the current authority retains
/// full control (including the ability to propose a corrected address, or
/// cancel outright) until the new one actively accepts.
#[derive(Accounts)]
pub struct ProposeAuthority<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = authority @ PodVaultError::Unauthorized,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    /// CHECK: new authority just needs to be a valid pubkey; no data on it is read.
    pub new_authority: UncheckedAccount<'info>,
}

pub fn propose_authority(ctx: Context<ProposeAuthority>) -> Result<()> {
    require!(
        ctx.accounts.new_authority.key() != Pubkey::default(),
        PodVaultError::InvalidNewAuthority
    );

    ctx.accounts.vault_config.pending_authority = ctx.accounts.new_authority.key();

    emit!(AuthorityProposedEvent {
        vault_config: ctx.accounts.vault_config.key(),
        current_authority: ctx.accounts.authority.key(),
        proposed_authority: ctx.accounts.new_authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Step 2 of 2: the nominated address itself must sign to actually take
/// over -- this is what makes the transfer safe against typos, since a
/// pubkey nobody controls can never accept.
#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    pub new_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
    )]
    pub vault_config: Account<'info, VaultConfig>,
}

pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
    require!(
        ctx.accounts.vault_config.pending_authority != Pubkey::default(),
        PodVaultError::NoPendingAuthorityTransfer
    );
    require!(
        ctx.accounts.vault_config.pending_authority == ctx.accounts.new_authority.key(),
        PodVaultError::NotThePendingAuthority
    );

    let old_authority = ctx.accounts.vault_config.authority;
    ctx.accounts.vault_config.authority = ctx.accounts.new_authority.key();
    ctx.accounts.vault_config.pending_authority = Pubkey::default();

    emit!(AuthorityUpdatedEvent {
        vault_config: ctx.accounts.vault_config.key(),
        old_authority,
        new_authority: ctx.accounts.new_authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Lets the current authority back out of a pending proposal before it's
/// accepted -- e.g. if they proposed the wrong address.
#[derive(Accounts)]
pub struct CancelAuthorityTransfer<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = authority @ PodVaultError::Unauthorized,
    )]
    pub vault_config: Account<'info, VaultConfig>,
}

pub fn cancel_authority_transfer(ctx: Context<CancelAuthorityTransfer>) -> Result<()> {
    require!(
        ctx.accounts.vault_config.pending_authority != Pubkey::default(),
        PodVaultError::NoPendingAuthorityTransfer
    );

    let cancelled_pending_authority = ctx.accounts.vault_config.pending_authority;
    ctx.accounts.vault_config.pending_authority = Pubkey::default();

    emit!(AuthorityTransferCancelledEvent {
        vault_config: ctx.accounts.vault_config.key(),
        cancelled_pending_authority,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Emergency switch: toggles whether wrap/unwrap are allowed. Does not
/// affect staking/unstaking/claiming.
#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = authority @ PodVaultError::Unauthorized,
    )]
    pub vault_config: Account<'info, VaultConfig>,
}

pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.vault_config.paused = paused;

    emit!(PausedSetEvent {
        vault_config: ctx.accounts.vault_config.key(),
        paused,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Only callable while total_staked == 0 (i.e. the current staked_lp_vault
/// necessarily holds zero tokens, per the vault's own invariant, so closing
/// it can't strand anyone's stake). Closes the existing staked_lp_vault and
/// clears lp_mint/staked_lp_vault back to defaults, so `set_lp_mint` can be
/// called again with a corrected address -- the one recovery path for
/// pointing the vault at the wrong LP mint before anyone's staked.
#[derive(Accounts)]
pub struct ResetLpMint<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = authority @ PodVaultError::Unauthorized,
        has_one = staked_lp_vault,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(mut)]
    pub staked_lp_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn reset_lp_mint(ctx: Context<ResetLpMint>) -> Result<()> {
    require!(
        ctx.accounts.vault_config.lp_mint != Pubkey::default(),
        PodVaultError::LpMintNotSet
    );
    require!(
        ctx.accounts.vault_config.total_staked == 0,
        PodVaultError::CannotResetWhileStaked
    );

    let tkn_mint_key = ctx.accounts.vault_config.tkn_mint;
    let seeds: &[&[u8]] = &[b"vault", tkn_mint_key.as_ref(), &[ctx.accounts.vault_config.bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    // staked_lp_vault is an SPL token account (owned by the Token Program,
    // not by this program), so it has to be closed via a CloseAccount CPI
    // rather than Anchor's `close = ...` constraint (which only works for
    // accounts this program itself owns).
    token::close_account(CpiContext::new_with_signer(
        Token::id(),
        CloseAccount {
            account: ctx.accounts.staked_lp_vault.to_account_info(),
            destination: ctx.accounts.authority.to_account_info(),
            authority: ctx.accounts.vault_config.to_account_info(),
        },
        signer_seeds,
    ))?;

    let vault_config = &mut ctx.accounts.vault_config;
    vault_config.lp_mint = Pubkey::default();
    vault_config.staked_lp_vault = Pubkey::default();

    emit!(LpMintResetEvent {
        vault_config: ctx.accounts.vault_config.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
