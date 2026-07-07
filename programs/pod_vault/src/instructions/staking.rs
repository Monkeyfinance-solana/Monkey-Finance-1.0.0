use anchor_lang::prelude::*;
use anchor_lang::Id;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::PodVaultError;
use crate::events::{RewardPaidEvent, StakeEvent, UnstakeEvent};
use crate::state::{StakeInfo, VaultConfig};

pub(crate) const SCALE: u128 = 1_000_000_000_000;

/// Pays out whatever reward has accrued on `stake_info` since its last
/// checkpoint, without changing `stake_info.amount`. Callers update
/// `amount` and `reward_debt` themselves afterward if the staked amount
/// is also changing in the same instruction. Updates `total_claimed`
/// whenever an actual payout happens, and returns the amount paid (0 if
/// nothing was pending) so the caller can emit the pool-appropriate event
/// (LP-pool callers emit `RewardPaidEvent`, bTKN-pool callers emit
/// `BtknRewardPaidEvent` -- this helper is shared by both pools, so it
/// doesn't emit an event itself).
pub(crate) fn settle_and_pay<'info>(
    stake_info: &mut Account<'info, StakeInfo>,
    acc_reward_per_share: u128,
    reward_vault_token_account: &Account<'info, TokenAccount>,
    user_reward_token_account: &Account<'info, TokenAccount>,
    vault_config_ai: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<u64> {
    let accrued = (stake_info.amount as u128)
        .checked_mul(acc_reward_per_share)
        .ok_or(PodVaultError::MathOverflow)?
        / SCALE;
    let pending = accrued
        .checked_sub(stake_info.reward_debt)
        .ok_or(PodVaultError::MathOverflow)?;

    if pending == 0 {
        return Ok(0);
    }

    let pending_u64: u64 = pending.try_into().map_err(|_| PodVaultError::MathOverflow)?;
    token::transfer(
        CpiContext::new_with_signer(
            Token::id(),
            Transfer {
                from: reward_vault_token_account.to_account_info(),
                to: user_reward_token_account.to_account_info(),
                authority: vault_config_ai.clone(),
            },
            signer_seeds,
        ),
        pending_u64,
    )?;

    stake_info.total_claimed = stake_info
        .total_claimed
        .checked_add(pending_u64)
        .ok_or(PodVaultError::MathOverflow)?;

    Ok(pending_u64)
}

#[derive(Accounts)]
pub struct StakeLp<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = lp_mint,
        has_one = staked_lp_vault,
        has_one = reward_vault_token_account,
    )]
    pub vault_config: Box<Account<'info, VaultConfig>>,

    pub lp_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub staked_lp_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub reward_vault_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_lp_token_account.mint == lp_mint.key(),
        constraint = user_lp_token_account.owner == user.key()
    )]
    pub user_lp_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_reward_token_account.mint == vault_config.tkn_mint,
        constraint = user_reward_token_account.owner == user.key()
    )]
    pub user_reward_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        space = StakeInfo::LEN,
        seeds = [b"stake", vault_config.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub stake_info: Box<Account<'info, StakeInfo>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn stake_lp(ctx: Context<StakeLp>, amount: u64) -> Result<()> {
    require!(amount > 0, PodVaultError::ZeroAmount);

    if ctx.accounts.stake_info.owner == Pubkey::default() {
        ctx.accounts.stake_info.owner = ctx.accounts.user.key();
        ctx.accounts.stake_info.vault_config = ctx.accounts.vault_config.key();
        ctx.accounts.stake_info.amount = 0;
        ctx.accounts.stake_info.reward_debt = 0;
        ctx.accounts.stake_info.bump = ctx.bumps.stake_info;
        ctx.accounts.stake_info.total_claimed = 0;
    }

    let acc = ctx.accounts.vault_config.acc_reward_per_share;
    let tkn_mint_key = ctx.accounts.vault_config.tkn_mint;
    let seeds: &[&[u8]] = &[b"vault", tkn_mint_key.as_ref(), &[ctx.accounts.vault_config.bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    let paid = settle_and_pay(
        &mut ctx.accounts.stake_info,
        acc,
        &ctx.accounts.reward_vault_token_account,
        &ctx.accounts.user_reward_token_account,
        ctx.accounts.vault_config.to_account_info(),
        signer_seeds,
    )?;
    if paid > 0 {
        emit!(RewardPaidEvent {
            vault_config: ctx.accounts.vault_config.key(),
            user: ctx.accounts.user.key(),
            amount: paid,
            timestamp: Clock::get()?.unix_timestamp,
        });
    }

    token::transfer(
        CpiContext::new(
            Token::id(),
            Transfer {
                from: ctx.accounts.user_lp_token_account.to_account_info(),
                to: ctx.accounts.staked_lp_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    let stake_info = &mut ctx.accounts.stake_info;
    stake_info.amount = stake_info.amount.checked_add(amount).ok_or(PodVaultError::MathOverflow)?;
    stake_info.reward_debt = (stake_info.amount as u128)
        .checked_mul(acc)
        .ok_or(PodVaultError::MathOverflow)?
        / SCALE;

    let vault_config = &mut ctx.accounts.vault_config;
    vault_config.total_staked = vault_config
        .total_staked
        .checked_add(amount)
        .ok_or(PodVaultError::MathOverflow)?;

    emit!(StakeEvent {
        vault_config: ctx.accounts.vault_config.key(),
        user: ctx.accounts.user.key(),
        amount,
        total_staked: ctx.accounts.vault_config.total_staked,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct UnstakeLp<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = lp_mint,
        has_one = staked_lp_vault,
        has_one = reward_vault_token_account,
    )]
    pub vault_config: Box<Account<'info, VaultConfig>>,

    pub lp_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub staked_lp_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub reward_vault_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_lp_token_account.mint == lp_mint.key(),
        constraint = user_lp_token_account.owner == user.key()
    )]
    pub user_lp_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_reward_token_account.mint == vault_config.tkn_mint,
        constraint = user_reward_token_account.owner == user.key()
    )]
    pub user_reward_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"stake", vault_config.key().as_ref(), user.key().as_ref()],
        bump = stake_info.bump,
        constraint = stake_info.owner == user.key() @ PodVaultError::Unauthorized,
    )]
    pub stake_info: Box<Account<'info, StakeInfo>>,

    pub token_program: Program<'info, Token>,
}

pub fn unstake_lp(ctx: Context<UnstakeLp>, amount: u64) -> Result<()> {
    require!(amount > 0, PodVaultError::ZeroAmount);
    require!(
        ctx.accounts.stake_info.amount >= amount,
        PodVaultError::InsufficientStake
    );

    let acc = ctx.accounts.vault_config.acc_reward_per_share;
    let tkn_mint_key = ctx.accounts.vault_config.tkn_mint;
    let seeds: &[&[u8]] = &[b"vault", tkn_mint_key.as_ref(), &[ctx.accounts.vault_config.bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    let paid = settle_and_pay(
        &mut ctx.accounts.stake_info,
        acc,
        &ctx.accounts.reward_vault_token_account,
        &ctx.accounts.user_reward_token_account,
        ctx.accounts.vault_config.to_account_info(),
        signer_seeds,
    )?;
    if paid > 0 {
        emit!(RewardPaidEvent {
            vault_config: ctx.accounts.vault_config.key(),
            user: ctx.accounts.user.key(),
            amount: paid,
            timestamp: Clock::get()?.unix_timestamp,
        });
    }

    token::transfer(
        CpiContext::new_with_signer(
            Token::id(),
            Transfer {
                from: ctx.accounts.staked_lp_vault.to_account_info(),
                to: ctx.accounts.user_lp_token_account.to_account_info(),
                authority: ctx.accounts.vault_config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    let stake_info = &mut ctx.accounts.stake_info;
    stake_info.amount = stake_info.amount.checked_sub(amount).ok_or(PodVaultError::MathOverflow)?;
    stake_info.reward_debt = (stake_info.amount as u128)
        .checked_mul(acc)
        .ok_or(PodVaultError::MathOverflow)?
        / SCALE;

    let vault_config = &mut ctx.accounts.vault_config;
    vault_config.total_staked = vault_config
        .total_staked
        .checked_sub(amount)
        .ok_or(PodVaultError::MathOverflow)?;

    emit!(UnstakeEvent {
        vault_config: ctx.accounts.vault_config.key(),
        user: ctx.accounts.user.key(),
        amount,
        total_staked: ctx.accounts.vault_config.total_staked,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = reward_vault_token_account,
    )]
    pub vault_config: Box<Account<'info, VaultConfig>>,

    #[account(mut)]
    pub reward_vault_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_reward_token_account.mint == vault_config.tkn_mint,
        constraint = user_reward_token_account.owner == user.key()
    )]
    pub user_reward_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"stake", vault_config.key().as_ref(), user.key().as_ref()],
        bump = stake_info.bump,
        constraint = stake_info.owner == user.key() @ PodVaultError::Unauthorized,
    )]
    pub stake_info: Box<Account<'info, StakeInfo>>,

    pub token_program: Program<'info, Token>,
}

pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let acc = ctx.accounts.vault_config.acc_reward_per_share;
    let tkn_mint_key = ctx.accounts.vault_config.tkn_mint;
    let seeds: &[&[u8]] = &[b"vault", tkn_mint_key.as_ref(), &[ctx.accounts.vault_config.bump]];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    let paid = settle_and_pay(
        &mut ctx.accounts.stake_info,
        acc,
        &ctx.accounts.reward_vault_token_account,
        &ctx.accounts.user_reward_token_account,
        ctx.accounts.vault_config.to_account_info(),
        signer_seeds,
    )?;
    if paid > 0 {
        emit!(RewardPaidEvent {
            vault_config: ctx.accounts.vault_config.key(),
            user: ctx.accounts.user.key(),
            amount: paid,
            timestamp: Clock::get()?.unix_timestamp,
        });
    }

    let stake_info = &mut ctx.accounts.stake_info;
    stake_info.reward_debt = (stake_info.amount as u128)
        .checked_mul(acc)
        .ok_or(PodVaultError::MathOverflow)?
        / SCALE;

    Ok(())
}
