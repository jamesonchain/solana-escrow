use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::{error::EscrowError, state::Escrow};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Make<'info> {
    // The maker pays to create the escrow and vault.
    #[account(mut)]
    pub maker: Signer<'info>,
    // Only the maker's token A account can fund this escrow.
    #[account(
        mut,
        token::mint = mint_a,
        token::authority = maker
    )]
    pub maker_token_a: Account<'info, TokenAccount>,
    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,
    // A maker can open separate escrows by choosing different seeds.
    #[account(
        init,
        payer = maker,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", maker.key().as_ref(), &seed.to_le_bytes()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    // The vault is the associated token account owned by the escrow PDA.
    #[account(
        init,
        payer = maker,
        associated_token::mint = mint_a,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_make(
    ctx: Context<Make>,
    seed: u64,
    amount_a: u64,
    amount_b: u64,
) -> Result<()> {
    // Reject empty trades and exchanges of a token for itself.
    require!(amount_a > 0 && amount_b > 0, EscrowError::InvalidAmount);
    require_keys_neq!(ctx.accounts.mint_a.key(), ctx.accounts.mint_b.key(), EscrowError::SameMint);

    // Save the escrow terms and the PDA bump for later signing.
    let escrow = &mut ctx.accounts.escrow;
    escrow.seed = seed;
    escrow.maker = ctx.accounts.maker.key();
    escrow.mint_a = ctx.accounts.mint_a.key();
    escrow.mint_b = ctx.accounts.mint_b.key();
    escrow.amount_a = amount_a;
    escrow.amount_b = amount_b;
    escrow.bump = ctx.bumps.escrow;

    // Move the offered token A into the escrow vault.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.maker_token_a.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.maker.to_account_info(),
            },
        ),
        amount_a,
    )
}
