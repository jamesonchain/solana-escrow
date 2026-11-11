# Solana Escrow

This is a small Anchor program for swapping two SPL tokens. A maker locks token A in a vault and sets the amount of token B they want. A taker can pay that amount to receive token A.

The escrow data and vault use program derived addresses. The vault is a token account controlled by the escrow address.

## Instructions

### make

The maker opens an escrow with a chosen seed, locks token A in the vault, and records the amount of token B they want.

### take

A taker sends the requested token B to the maker and receives token A. The vault and escrow account close after the trade.

### refund

The maker can cancel an open escrow and return token A to their own token account. The vault and escrow account close.

### update

The maker can change the amount of token B they want before the escrow is completed.

## Build

Run this command to build the program and generate its IDL:

```text
npm run build
```

The build command uses platform tools version 1.52 and SBPF architecture v2. This worked with Anchor CLI 1.2.1 and Solana CLI 3.1.10 on this machine.

## Tests

Run the TypeScript LiteSVM tests with:

```text
npm test
```

This builds the program, checks the TypeScript, and runs tests for make, take, refund, update, and a refund attempt by someone other than the maker.

## What I learned

I learned that a program derived address can control a token vault. I also learned that the token transfer and closing the vault can happen in the same transaction. LiteSVM let me try the program without starting a local validator.

This is a learning project. It has not been audited or deployed.
