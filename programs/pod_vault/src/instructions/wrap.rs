use anchor_lang::prelude::*;
use anchor_lang::Id;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::errors::PodVaultError;
use crate::events::WrapEvent;
use crate::state::VaultConfig;

const SCALE: u128 = 1_000_000_000_000;

#[derive(Accounts)]
pub struct Wrap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_config.tkn_mint.as_ref()],
        bump = vault_config.bump,
        has_one = tkn_mint,
        has_one = btkn_mint,
        has_one = vault_token_account,
        has_one = reward_vault_token_account,
        has_one = protocol_token_account,
    )]
    pub vault_config: Box<Account<'info, VaultConfig>>,

    #[account(mut)]
    pub tkn_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub btkn_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub reward_vault_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub protocol_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_tkn_account.mint == tkn_mint.key(),
        constraint = user_tkn_account.owner == user.key()
    )]
    pub user_tkn_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = btkn_mint,
        associated_token::authority = user,
    )]
    pub user_btkn_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Wrap>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.vault_config.paused, PodVaultError::VaultPaused);
    require!(amount > 0, PodVaultError::ZeroAmount);

    let fee_bps = ctx.accounts.vault_config.wrap_fee_bps as u128;
    let fee: u64 = ((amount as u128)
        .checked_mul(fee_bps)
        .ok_or(PodVaultError::MathOverflow)?
        / 10_000u128)
        .try_into()
        .map_err(|_| PodVaultError::MathOverflow)?;

    let net = amount.checked_sub(fee).ok_or(PodVaultError::MathOverflow)?;
    require!(net > 0, PodVaultError::AmountBelowFee);

    // user -> vault: the part that backs newly minted bTKN 1:1
    token::transfer(
        CpiContext::new(
            Token::id(),
            Transfer {
                from: ctx.accounts.user_tkn_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        net,
    )?;

    let mut burn_amount: u64 = 0;
    let mut protocol_amount: u64 = 0;
    let mut lp_reward_amount: u64 = 0;
    let mut btkn_reward_amount: u64 = 0;

    if fee > 0 {
        // Every bucket below is a direct % *of the fee itself* (flat, not
        // nested/sequential) -- burn_bps + protocol_bps + btkn_share_bps is
        // enforced <= 10_000 in update_fees/initialize_vault, so
        // lp_reward_amount (the remainder) can never go negative, and it
        // also absorbs any rounding dust from the three integer divisions.
        let fee_u128 = fee as u128;
        let burn_bps = ctx.accounts.vault_config.burn_bps as u128;
        let protocol_bps = ctx.accounts.vault_config.protocol_bps as u128;
        let btkn_share_bps = ctx.accounts.vault_config.btkn_share_bps as u128;

        burn_amount = (fee_u128
            .checked_mul(burn_bps)
            .ok_or(PodVaultError::MathOverflow)?
            / 10_000u128)
            .try_into()
            .map_err(|_| PodVaultError::MathOverflow)?;
        protocol_amount = (fee_u128
            .checked_mul(protocol_bps)
            .ok_or(PodVaultError::MathOverflow)?
            / 10_000u128)
            .try_into()
            .map_err(|_| PodVaultError::MathOverflow)?;
        btkn_reward_amount = (fee_u128
            .checked_mul(btkn_share_bps)
            .ok_or(PodVaultError::MathOverflow)?
            / 10_000u128)
            .try_into()
            .map_err(|_| PodVaultError::MathOverflow)?;
        lp_reward_amount = fee
            .checked_sub(burn_amount)
            .ok_or(PodVaultError::MathOverflow)?
            .checked_sub(protocol_amount)
            .ok_or(PodVaultError::MathOverflow)?
            .checked_sub(btkn_reward_amount)
            .ok_or(PodVaultError::MathOverflow)?;

        // Nobody staked in one (or both) pools to credit that portion to --
        // burn it instead rather than let it sit unclaimable in the reward
        // vault forever. Handled independently per pool. Same idea for
        // protocol_amount if the wallet somehow isn't set (shouldn't happen
        // given initialize_vault requires one, but defense-in-depth).
        if ctx.accounts.vault_config.total_staked == 0 {
            burn_amount = burn_amount.checked_add(lp_reward_amount).ok_or(PodVaultError::MathOverflow)?;
            lp_reward_amount = 0;
        }
        if ctx.accounts.vault_config.total_btkn_staked == 0 {
            burn_amount = burn_amount.checked_add(btkn_reward_amount).ok_or(PodVaultError::MathOverflow)?;
            btkn_reward_amount = 0;
        }
        if ctx.accounts.vault_config.protocol_token_account == Pubkey::default() {
            burn_amount = burn_amount.checked_add(protocol_amount).ok_or(PodVaultError::MathOverflow)?;
            protocol_amount = 0;
        }

        if burn_amount > 0 {
            token::burn(
                CpiContext::new(
                    Token::id(),
                    Burn {
                        mint: ctx.accounts.tkn_mint.to_account_info(),
                        from: ctx.accounts.user_tkn_account.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                burn_amount,
            )?;

            let vault_config = &mut ctx.accounts.vault_config;
            vault_config.total_burned = vault_config
                .total_burned
                .checked_add(burn_amount)
                .ok_or(PodVaultError::MathOverflow)?;
        }

        if protocol_amount > 0 {
            token::transfer(
                CpiContext::new(
                    Token::id(),
                    Transfer {
                        from: ctx.accounts.user_tkn_account.to_account_info(),
                        to: ctx.accounts.protocol_token_account.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                protocol_amount,
            )?;

            let vault_config = &mut ctx.accounts.vault_config;
            vault_config.total_protocol_distributed = vault_config
                .total_protocol_distributed
                .checked_add(protocol_amount)
                .ok_or(PodVaultError::MathOverflow)?;
        }

        if lp_reward_amount > 0 || btkn_reward_amount > 0 {
            token::transfer(
                CpiContext::new(
                    Token::id(),
                    Transfer {
                        from: ctx.accounts.user_tkn_account.to_account_info(),
                        to: ctx.accounts.reward_vault_token_account.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                lp_reward_amount + btkn_reward_amount,
            )?;
        }

        if lp_reward_amount > 0 {
            let vault_config = &mut ctx.accounts.vault_config;
            let increment = (lp_reward_amount as u128)
                .checked_mul(SCALE)
                .ok_or(PodVaultError::MathOverflow)?
                / vault_config.total_staked as u128;
            vault_config.acc_reward_per_share = vault_config
                .acc_reward_per_share
                .checked_add(increment)
                .ok_or(PodVaultError::MathOverflow)?;
            vault_config.total_reward_distributed = vault_config
                .total_reward_distributed
                .checked_add(lp_reward_amount)
                .ok_or(PodVaultError::MathOverflow)?;
        }

        if btkn_reward_amount > 0 {
            let vault_config = &mut ctx.accounts.vault_config;
            let increment = (btkn_reward_amount as u128)
                .checked_mul(SCALE)
                .ok_or(PodVaultError::MathOverflow)?
                / vault_config.total_btkn_staked as u128;
            vault_config.acc_btkn_reward_per_share = vault_config
                .acc_btkn_reward_per_share
                .checked_add(increment)
                .ok_or(PodVaultError::MathOverflow)?;
            vault_config.total_btkn_reward_distributed = vault_config
                .total_btkn_reward_distributed
                .checked_add(btkn_reward_amount)
                .ok_or(PodVaultError::MathOverflow)?;
        }
    }

    // vault PDA signs to mint bTKN to the user
    let tkn_mint_key = ctx.accounts.tkn_mint.key();
    let seeds: &[&[u8]] = &[
        b"vault",
        tkn_mint_key.as_ref(),
        &[ctx.accounts.vault_config.bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    token::mint_to(
        CpiContext::new_with_signer(
            Token::id(),
            MintTo {
                mint: ctx.accounts.btkn_mint.to_account_info(),
                to: ctx.accounts.user_btkn_account.to_account_info(),
                authority: ctx.accounts.vault_config.to_account_info(),
            },
            signer_seeds,
        ),
        net,
    )?;

    let vault_config = &mut ctx.accounts.vault_config;
    vault_config.total_wrapped = vault_config
        .total_wrapped
        .checked_add(net)
        .ok_or(PodVaultError::MathOverflow)?;

    emit!(WrapEvent {
        vault_config: ctx.accounts.vault_config.key(),
        user: ctx.accounts.user.key(),
        amount_in: amount,
        fee,
        burned: burn_amount,
        to_protocol: protocol_amount,
        to_reward_pot: lp_reward_amount,
        to_btkn_reward_pot: btkn_reward_amount,
        btkn_minted: net,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
