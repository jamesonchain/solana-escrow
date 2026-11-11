use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

use crate::state::Escrow;

#[derive(Accounts)]
pub struct Take<'info> {
    // The taker signs and pays the offered token B.
    #[account(mut)]
    pub taker: Signer<'info>,
    // The saved maker receives token B and the rent returned on close.
    #[account(mut)]
    pub maker: SystemAccount<'info>,
    #[account(
        mut,
        close = maker,
        seeds = [b"escrow", escrow.maker.as_ref(), &escrow.seed.to_le_bytes()],
        bump = escrow.bump,
        has_one = maker
    )]
    pub escrow: Account<'info, Escrow>,
    // Token B must come from the taker's own account.
    #[account(
        mut,
        token::mint = escrow.mint_b,
        token::authority = taker
    )]
    pub taker_token_b: Account<'info, TokenAccount>,
    // Token B is paid to the maker's account for the escrow's mint.
    #[account(
        mut,
        token::mint = escrow.mint_b,
        token::authority = maker
    )]
    pub maker_token_b: Account<'info, TokenAccount>,
    // Token A is delivered only to the taker's own account.
    #[account(
        mut,
        token::mint = escrow.mint_a,
        token::authority = taker
    )]
    pub taker_token_a: Account<'info, TokenAccount>,
    // Anchor verifies this is the escrow PDA's token A account.
    #[account(
        mut,
        associated_token::mint = escrow.mint_a,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_take(ctx: Context<Take>) -> Result<()> {
    // Prepare the escrow PDA seeds for both token account CPIs.
    let seed = ctx.accounts.escrow.seed.to_le_bytes();
    let bump = [ctx.accounts.escrow.bump];
    let signer_seeds: &[&[u8]] = &[
        b"escrow",
        ctx.accounts.escrow.maker.as_ref(),
        &seed,
        &bump,
    ];

    // Pay the maker before releasing token A, in one atomic transaction.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.taker_token_b.to_account_info(),
                to: ctx.accounts.maker_token_b.to_account_info(),
                authority: ctx.accounts.taker.to_account_info(),
            },
        ),
        ctx.accounts.escrow.amount_b,
    )?;

    // Release the locked token A to the taker.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.taker_token_a.to_account_info(),
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
