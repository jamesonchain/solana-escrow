use anchor_lang::prelude::*;

// Explain the checks the escrow instructions enforce.
#[error_code]
pub enum EscrowError {
    #[msg("Token amounts must be greater than zero")]
    InvalidAmount,
    #[msg("Token A and token B must use different mints")]
    SameMint,
}
