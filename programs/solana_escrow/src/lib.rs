pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use state::*;

declare_id!("9MtthxjMZ3Y8BHNR8nSBLtMbfxWfFaW9EHegJrDSpbrw");

#[program]
pub mod solana_escrow {
    use super::*;

    // Lock token A and record the token B price.
    pub fn make(ctx: Context<Make>, seed: u64, amount_a: u64, amount_b: u64) -> Result<()> {
        instructions::make::handle_make(ctx, seed, amount_a, amount_b)
    }

    // Trade token B for the locked token A and close the escrow.
    pub fn take(ctx: Context<Take>) -> Result<()> {
        instructions::take::handle_take(ctx)
    }

    // Return token A to the maker and close the escrow.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund::handle_refund(ctx)
    }

    // Change the amount of token B requested by the maker.
    pub fn update(ctx: Context<Update>, new_amount_b: u64) -> Result<()> {
        instructions::update::handle_update(ctx, new_amount_b)
    }
}
