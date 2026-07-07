use anchor_lang::prelude::*;
use anchor_lang::Id;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::PodVaultError;
use crate::events::{BtknRewardPaidEvent, BtknStakeEvent, BtknUnstakeEvent};
use crate::instructions::staking::settle_and_pay;
use crate::state::{StakeInfo, VaultConfig};

const SCALE: u128 = 1_000_000_000_000;

/// Stake bTKN directly to earn a share of fees, without needing to provide
/// LP at all. This is the "just wrap and hold, but actually earn something"
/// option -- it works the moment the vault exists, since it has no
/// dependency on an external AMM pool the way LP staking does.
#[derive(Accounts)]
pub struct StakeBtkn<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = btkn_mint,
        has_one = staked_btkn_vault,
        has_one = reward_vault_token_account,
    )]
    pub vault_config: Box<Account<'info, VaultConfig>>,

    pub btkn_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub staked_btkn_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub reward_vault_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_btkn_account.mint == btkn_mint.key(),
        constraint = user_btkn_account.owner == user.key()
    )]
    pub user_btkn_account: Box<Account<'info, TokenAccount>>,

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
        seeds = [b"btkn_stake", vault_config.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub stake_info: Box<Account<'info, StakeInfo>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn stake_btkn(ctx: Context<StakeBtkn>, amount: u64) -> Result<()> {
    require!(amount > 0, PodVaultError::ZeroAmount);

    if ctx.accounts.stake_info.owner == Pubkey::default() {
        ctx.accounts.stake_info.owner = ctx.accounts.user.key();
        ctx.accounts.stake_info.vault_config = ctx.accounts.vault_config.key();
        ctx.accounts.stake_info.amount = 0;
        ctx.accounts.stake_info.reward_debt = 0;
        ctx.accounts.stake_info.bump = ctx.bumps.stake_info;
        ctx.accounts.stake_info.total_claimed = 0;
    }

    let acc = ctx.accounts.vault_config.acc_btkn_reward_per_share;
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
        emit!(BtknRewardPaidEvent {
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
                from: ctx.accounts.user_btkn_account.to_account_info(),
                to: ctx.accounts.staked_btkn_vault.to_account_info(),
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
    vault_config.total_btkn_staked = vault_config
        .total_btkn_staked
        .checked_add(amount)
        .ok_or(PodVaultError::MathOverflow)?;

    emit!(BtknStakeEvent {
        vault_config: ctx.accounts.vault_config.key(),
        user: ctx.accounts.user.key(),
        amount,
        total_btkn_staked: ctx.accounts.vault_config.total_btkn_staked,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct UnstakeBtkn<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = btkn_mint,
        has_one = staked_btkn_vault,
        has_one = reward_vault_token_account,
    )]
    pub vault_config: Box<Account<'info, VaultConfig>>,

    pub btkn_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub staked_btkn_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub reward_vault_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_btkn_account.mint == btkn_mint.key(),
        constraint = user_btkn_account.owner == user.key()
    )]
    pub user_btkn_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_reward_token_account.mint == vault_config.tkn_mint,
        constraint = user_reward_token_account.owner == user.key()
    )]
    pub user_reward_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"btkn_stake", vault_config.key().as_ref(), user.key().as_ref()],
        bump = stake_info.bump,
        constraint = stake_info.owner == user.key() @ PodVaultError::Unauthorized,
    )]
    pub stake_info: Box<Account<'info, StakeInfo>>,

    pub token_program: Program<'info, Token>,
}

pub fn unstake_btkn(ctx: Context<UnstakeBtkn>, amount: u64) -> Result<()> {
    require!(amount > 0, PodVaultError::ZeroAmount);
    require!(
        ctx.accounts.stake_info.amount >= amount,
        PodVaultError::InsufficientStake
    );

    let acc = ctx.accounts.vault_config.acc_btkn_reward_per_share;
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
        emit!(BtknRewardPaidEvent {
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
                from: ctx.accounts.staked_btkn_vault.to_account_info(),
                to: ctx.accounts.user_btkn_account.to_account_info(),
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
    vault_config.total_btkn_staked = vault_config
        .total_btkn_staked
        .checked_sub(amount)
        .ok_or(PodVaultError::MathOverflow)?;

    emit!(BtknUnstakeEvent {
        vault_config: ctx.accounts.vault_config.key(),
        user: ctx.accounts.user.key(),
        amount,
        total_btkn_staked: ctx.accounts.vault_config.total_btkn_staked,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimBtknRewards<'info> {
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
        seeds = [b"btkn_stake", vault_config.key().as_ref(), user.key().as_ref()],
        bump = stake_info.bump,
        constraint = stake_info.owner == user.key() @ PodVaultError::Unauthorized,
    )]
    pub stake_info: Box<Account<'info, StakeInfo>>,

    pub token_program: Program<'info, Token>,
}

pub fn claim_btkn_rewards(ctx: Context<ClaimBtknRewards>) -> Result<()> {
    let acc = ctx.accounts.vault_config.acc_btkn_reward_per_share;
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
        emit!(BtknRewardPaidEvent {
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
