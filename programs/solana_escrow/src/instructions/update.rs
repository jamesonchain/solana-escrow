use anchor_lang::prelude::*;

use crate::{error::EscrowError, state::Escrow};

#[derive(Accounts)]
pub struct Update<'info> {
    // Only the maker saved in the escrow can change its price.
    pub maker: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.maker.as_ref(), &escrow.seed.to_le_bytes()],
        bump = escrow.bump,
        has_one = maker
    )]
    pub escrow: Account<'info, Escrow>,
}

pub fn handle_update(ctx: Context<Update>, new_amount_b: u64) -> Result<()> {
    // Do not change the price to zero.
    require!(new_amount_b > 0, EscrowError::InvalidAmount);

    // Save the new amount of token B requested.
    ctx.accounts.escrow.amount_b = new_amount_b;
    Ok(())
}
