use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token::{Mint, Token, TokenAccount};
use mpl_token_metadata::instructions::CreateV1Builder;
use mpl_token_metadata::types::TokenStandard;

use crate::errors::PodVaultError;
use crate::state::VaultConfig;

/// Converts an anchor-lang `Pubkey` into whatever `Pubkey` type a foreign
/// crate (like `mpl-token-metadata`) expects, via a raw 32-byte round-trip.
///
/// This project's Cargo dependency graph ends up with two separately
/// versioned copies of the split-out Solana SDK crates (anchor-lang 1.1.2
/// pins an older generation than `mpl-token-metadata` 5.1.1 pulls
/// transitively) -- meaning `anchor_lang::prelude::Pubkey` and
/// `mpl_token_metadata`'s own `Pubkey` are, to the compiler, two unrelated
/// types, even though they're both just a 32-byte array underneath. Rather
/// than fighting Cargo to unify the two dependency trees (not possible here
/// without bumping anchor-lang itself), every Solana Pubkey type -- across
/// every SDK generation -- implements `From<[u8; 32]>`, so this generic
/// helper converts through that common, version-stable ground truth. `T` is
/// inferred from each call site's target (e.g. `CreateV1Builder::metadata`'s
/// parameter type), so callers never need to name the foreign type at all.
fn to_foreign_pubkey<T: From<[u8; 32]>>(pk: &Pubkey) -> T {
    T::from(pk.to_bytes())
}

/// Metaplex's `MAX_NAME_LENGTH`/`MAX_SYMBOL_LENGTH`/`MAX_URI_LENGTH` (from
/// `mpl_token_metadata::pda`/state constants) -- duplicated here as plain
/// `usize`s so `initialize_vault` can reject an oversized name/symbol/uri
/// up front with a clear program error, instead of the CPI failing deep
/// inside the Metaplex program with a much less legible error code.
const MPL_MAX_NAME_LENGTH: usize = 32;
const MPL_MAX_SYMBOL_LENGTH: usize = 10;
const MPL_MAX_URI_LENGTH: usize = 200;

#[derive(Accounts)]
#[instruction(
    wrap_fee_bps: u16,
    unwrap_fee_bps: u16,
    burn_bps: u16,
    protocol_bps: u16,
    btkn_share_bps: u16,
    btkn_name: String,
    btkn_symbol: String,
    btkn_uri: String
)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The underlying token (TKN) this pod wraps. This should already exist
    /// (e.g. the mint you got back from launching TKN on pump.fun).
    pub tkn_mint: Box<Account<'info, Mint>>,

    /// Destination for the protocol-revenue share of fees (see
    /// `protocol_bps`) -- must already exist and hold TKN (e.g. an ATA of
    /// the vault deployer's own wallet). Required even if protocol_bps is
    /// 0 at first, so `set_protocol_wallet`/`update_fees` never have to deal
    /// with an unset destination. Changeable later via `set_protocol_wallet`.
    #[account(constraint = protocol_token_account.mint == tkn_mint.key())]
    pub protocol_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = authority,
        space = VaultConfig::LEN,
        seeds = [b"vault", tkn_mint.key().as_ref()],
        bump
    )]
    pub vault_config: Box<Account<'info, VaultConfig>>,

    /// The wrapped token (bTKN), minted 1:1 against deposits. The vault PDA
    /// itself is the mint authority, so only this program can ever mint it.
    #[account(
        init,
        payer = authority,
        seeds = [b"btkn_mint", tkn_mint.key().as_ref()],
        bump,
        mint::decimals = tkn_mint.decimals,
        mint::authority = vault_config,
    )]
    pub btkn_mint: Box<Account<'info, Mint>>,

    /// Vault's holding account for deposited TKN, owned by the vault PDA.
    /// This backs bTKN 1:1 -- fees never touch it.
    #[account(
        init,
        payer = authority,
        seeds = [b"vault_tkn", tkn_mint.key().as_ref()],
        bump,
        token::mint = tkn_mint,
        token::authority = vault_config,
    )]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,

    /// Holds the LP-reward share of collected fees until stakers claim it.
    /// (A plain PDA-owned token account, not an ATA -- an ATA would collide
    /// with vault_token_account since both hold the same mint under the
    /// same owner.)
    #[account(
        init,
        payer = authority,
        seeds = [b"reward_vault", tkn_mint.key().as_ref()],
        bump,
        token::mint = tkn_mint,
        token::authority = vault_config,
    )]
    pub reward_vault_token_account: Box<Account<'info, TokenAccount>>,

    /// Holds staked bTKN in custody for the bTKN-staking pool. Created here
    /// (unlike staked_lp_vault, which waits for `set_lp_mint`) since bTKN's
    /// mint is already known -- bTKN staking works from the moment the vault
    /// exists, no external pool required.
    #[account(
        init,
        payer = authority,
        seeds = [b"staked_btkn", tkn_mint.key().as_ref()],
        bump,
        token::mint = btkn_mint,
        token::authority = vault_config,
    )]
    pub staked_btkn_vault: Box<Account<'info, TokenAccount>>,

    /// Unallocated Metaplex Metadata PDA for bTKN -- created via CPI inside
    /// the handler so bTKN can carry the same name/symbol/image as TKN from
    /// the moment it's minted. Anchor only validates the address here (via
    /// `seeds`/`seeds::program`); the account is actually created by the
    /// `CreateV1` CPI below, not by an `init` constraint, since Anchor
    /// doesn't know how to initialize another program's account type.
    /// CHECK: address fully constrained by `seeds`/`bump`/`seeds::program`
    /// against the real Metaplex Token Metadata program; contents are
    /// written by that program via the CPI in the handler, not by us.
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), btkn_mint.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key(),
    )]
    pub btkn_metadata: UncheckedAccount<'info>,

    /// CHECK: address-constrained to the real Metaplex Token Metadata
    /// program id (`metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`); this is
    /// the program being CPI'd into, not our data. Hardcoded via `Pubkey`'s
    /// `FromStr` (base58) parsing rather than `mpl_token_metadata::ID`
    /// directly, since that constant is a `Pubkey` from a different
    /// (incompatible, separately-versioned) copy of the solana-pubkey crate
    /// than the one anchor-lang uses here -- comparing the two directly is a
    /// type error, not just a style choice. Also avoids the `pubkey!` macro,
    /// whose path isn't resolvable in this crate-version combination.
    #[account(address = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s".parse::<Pubkey>().unwrap())]
    pub token_metadata_program: UncheckedAccount<'info>,

    /// CHECK: address-constrained to the well-known Instructions sysvar
    /// address (`Sysvar1nstructions1111111111111111111111111`), required by
    /// Metaplex's `CreateV1` instruction (used for instruction introspection
    /// on their end), not read by us. Hardcoded via `Pubkey`'s `FromStr`
    /// parsing (see `token_metadata_program` above for why).
    #[account(address = "Sysvar1nstructions1111111111111111111111111".parse::<Pubkey>().unwrap())]
    pub sysvar_instructions: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
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
        btkn_name.len() <= MPL_MAX_NAME_LENGTH,
        PodVaultError::MetadataFieldTooLong
    );
    require!(
        btkn_symbol.len() <= MPL_MAX_SYMBOL_LENGTH,
        PodVaultError::MetadataFieldTooLong
    );
    require!(
        btkn_uri.len() <= MPL_MAX_URI_LENGTH,
        PodVaultError::MetadataFieldTooLong
    );

    let vault_config = &mut ctx.accounts.vault_config;
    vault_config.authority = ctx.accounts.authority.key();
    vault_config.pending_authority = Pubkey::default();
    vault_config.tkn_mint = ctx.accounts.tkn_mint.key();
    vault_config.btkn_mint = ctx.accounts.btkn_mint.key();
    vault_config.vault_token_account = ctx.accounts.vault_token_account.key();
    vault_config.reward_vault_token_account = ctx.accounts.reward_vault_token_account.key();
    vault_config.lp_mint = Pubkey::default();
    vault_config.staked_lp_vault = Pubkey::default();
    vault_config.staked_btkn_vault = ctx.accounts.staked_btkn_vault.key();
    vault_config.protocol_token_account = ctx.accounts.protocol_token_account.key();
    vault_config.wrap_fee_bps = wrap_fee_bps;
    vault_config.unwrap_fee_bps = unwrap_fee_bps;
    vault_config.burn_bps = burn_bps;
    vault_config.protocol_bps = protocol_bps;
    vault_config.btkn_share_bps = btkn_share_bps;
    vault_config.acc_reward_per_share = 0;
    vault_config.acc_btkn_reward_per_share = 0;
    vault_config.total_staked = 0;
    vault_config.total_btkn_staked = 0;
    vault_config.total_wrapped = 0;
    vault_config.total_unwrapped = 0;
    vault_config.total_burned = 0;
    vault_config.total_reward_distributed = 0;
    vault_config.total_btkn_reward_distributed = 0;
    vault_config.total_protocol_distributed = 0;
    vault_config.bump = ctx.bumps.vault_config;
    vault_config.btkn_mint_bump = ctx.bumps.btkn_mint;
    vault_config.paused = false;

    // Create bTKN's Metaplex metadata, capturing TKN's name/symbol/image
    // (the caller fetches TKN's existing metadata off-chain and forwards
    // matching values here -- see init_vault.ts). This must happen via CPI
    // from inside this program because bTKN's mint authority is the
    // `vault_config` PDA, and only this program can produce that PDA's
    // signature (via `invoke_signed` below), which Metaplex's `CreateV1`
    // requires as proof of mint-authority control.
    //
    // We build the instruction using mpl-token-metadata's *off-chain*
    // `CreateV1Builder` (Pubkey/String-based, not the `AccountInfo`-based
    // `CreateV1CpiBuilder`) and then hand-convert the resulting plain
    // `Instruction` into anchor-lang's own `Instruction`/`AccountMeta`
    // types before invoking it via anchor's own `invoke_signed`. This
    // deliberately never touches mpl-token-metadata's own `AccountInfo`
    // type or its own CPI/ProgramResult machinery. `Instruction` is just
    // plain data (a program id, a list of pubkey/signer/writable tuples,
    // and a byte buffer), so it survives the round-trip through a
    // differently-versioned crate with zero risk, sidestepping this
    // project's cross-generation Solana SDK dependency conflict entirely.
    let vault_config_key = ctx.accounts.vault_config.key();

    let mpl_ix = CreateV1Builder::new()
        .metadata(to_foreign_pubkey(&ctx.accounts.btkn_metadata.key()))
        .mint(to_foreign_pubkey(&ctx.accounts.btkn_mint.key()), false)
        .authority(to_foreign_pubkey(&vault_config_key))
        .payer(to_foreign_pubkey(&ctx.accounts.authority.key()))
        .update_authority(to_foreign_pubkey(&vault_config_key), true)
        .system_program(to_foreign_pubkey(&ctx.accounts.system_program.key()))
        .sysvar_instructions(to_foreign_pubkey(&ctx.accounts.sysvar_instructions.key()))
        .spl_token_program(Some(to_foreign_pubkey(&ctx.accounts.token_program.key())))
        .name(btkn_name)
        .symbol(btkn_symbol)
        .uri(btkn_uri)
        .seller_fee_basis_points(0)
        .token_standard(TokenStandard::Fungible)
        .decimals(ctx.accounts.tkn_mint.decimals)
        .primary_sale_happened(false)
        .is_mutable(true)
        .instruction();

    // Convert mpl's Instruction (foreign Pubkey/AccountMeta types) into
    // anchor-lang's own, via a raw 32-byte round-trip -- same trick as
    // `to_foreign_pubkey` above, just in the opposite direction.
    let anchor_program_id = Pubkey::from(mpl_ix.program_id.to_bytes());
    let anchor_accounts: Vec<AccountMeta> = mpl_ix
        .accounts
        .iter()
        .map(|m| {
            let pk = Pubkey::from(m.pubkey.to_bytes());
            if m.is_writable {
                AccountMeta::new(pk, m.is_signer)
            } else {
                AccountMeta::new_readonly(pk, m.is_signer)
            }
        })
        .collect();
    let anchor_ix = Instruction {
        program_id: anchor_program_id,
        accounts: anchor_accounts,
        data: mpl_ix.data,
    };

    let tkn_mint_key = ctx.accounts.tkn_mint.key();
    let vault_bump = ctx.bumps.vault_config;
    let vault_seeds: &[&[u8]] = &[b"vault", tkn_mint_key.as_ref(), &[vault_bump]];
    let signer_seeds: &[&[&[u8]]] = &[vault_seeds];

    let account_infos = [
        ctx.accounts.token_metadata_program.to_account_info(),
        ctx.accounts.btkn_metadata.to_account_info(),
        ctx.accounts.btkn_mint.to_account_info(),
        ctx.accounts.vault_config.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.sysvar_instructions.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
    ];

    invoke_signed(&anchor_ix, &account_infos, signer_seeds)?;

    Ok(())
}
