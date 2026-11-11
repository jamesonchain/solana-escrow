use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

use crate::state::Escrow;

#[derive(Accounts)]
pub struct Refund<'info> {
    // The maker must sign and receives token A and the rent on close.
    #[account(mut)]
    pub maker: Signer<'info>,
    #[account(
        mut,
        close = maker,
        seeds = [b"escrow", escrow.maker.as_ref(), &escrow.seed.to_le_bytes()],
        bump = escrow.bump,
        has_one = maker
    )]
    pub escrow: Account<'info, Escrow>,
    // Return token A to an account owned by the maker.
    #[account(
        mut,
        token::mint = escrow.mint_a,
        token::authority = maker
    )]
    pub maker_token_a: Account<'info, TokenAccount>,
    // Anchor verifies this is the escrow PDA's token A account.
    #[account(
        mut,
        associated_token::mint = escrow.mint_a,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_refund(ctx: Context<Refund>) -> Result<()> {
    // Prepare the escrow PDA seeds to authorize the return transfer.
    let seed = ctx.accounts.escrow.seed.to_le_bytes();
    let bump = [ctx.accounts.escrow.bump];
    let signer_seeds: &[&[u8]] = &[
        b"escrow",
        ctx.accounts.escrow.maker.as_ref(),
        &seed,
        &bump,
    ];

    // Return token A to the maker.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.maker_token_a.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            &[signer_seeds],
        ),
        ctx.accounts.escrow.amount_a,
    )?;

    // Close the empty vault and return its rent to the maker.
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        },
        &[signer_seeds],
    ))
}
