import { expect } from "chai";
import { readFileSync } from "fs";
import {
  AccountRole,
  address,
  createClient,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  getUtf8Encoder,
  lamports,
} from "@solana/kit";
import type { Address, TransactionSigner } from "@solana/kit";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  fetchToken,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getCreateMintInstructionPlan,
  getMintToATAInstructionPlanAsync,
} from "@solana-program/token";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { litesvm } from "@solana/kit-plugin-litesvm";
import { generatedSigner } from "@solana/kit-plugin-signer";

// Read the IDL produced by the build so instruction bytes stay in sync.
const escrowIdl: {
  address: string;
  instructions: {
    name: string;
    discriminator: number[];
    accounts: { name: string; writable?: boolean; signer?: boolean }[];
    args: { name: string; type: string }[];
  }[];
} = JSON.parse(readFileSync("target/idl/solana_escrow.json", "utf8"));
const programAddress = address(escrowIdl.address);
const rentAddress = address("SysvarRent111111111111111111111111111111111");
const offeredAmount = 100n;
const requestedAmount = 250n;

type IdlInstruction = (typeof escrowIdl.instructions)[number];
type AccountAddresses = Record<string, Address>;
type InstructionSigners = Record<string, TransactionSigner>;

// Encode the generated Anchor IDL into a Kit instruction.
function makeInstruction(
  name: IdlInstruction["name"],
  accountAddresses: AccountAddresses,
  args: bigint[] = [],
  signers: InstructionSigners = {}
) {
  const definition = escrowIdl.instructions.find(
    (instruction) => instruction.name === name
  );
  if (!definition) {
    throw new Error(`Instruction ${name} is missing from the generated IDL`);
  }
  if (definition.args.length !== args.length) {
    throw new Error(`Wrong number of arguments for ${name}`);
  }
  if (definition.args.some((argument) => argument.type !== "u64")) {
    throw new Error(`Unsupported argument type in ${name}`);
  }

  // This assignment uses the u64 arguments defined by the IDL.
  const data = new Uint8Array(
    definition.discriminator.length + args.length * 8
  );
  data.set(definition.discriminator);
  args.forEach((value, index) => {
    data.set(
      getU64Encoder().encode(value),
      definition.discriminator.length + index * 8
    );
  });

  // The IDL supplies account order and signer and writable flags.
  const accounts = definition.accounts.map((account) => {
    const accountAddress = accountAddresses[account.name];
    if (!accountAddress) {
      throw new Error(`Missing ${account.name} account for ${name}`);
    }

    const signer = signers[account.name];
    if (account.signer && !signer) {
      throw new Error(`Missing ${account.name} signer for ${name}`);
    }
    const role = account.signer
      ? account.writable
        ? AccountRole.WRITABLE_SIGNER
        : AccountRole.READONLY_SIGNER
      : account.writable
      ? AccountRole.WRITABLE
      : AccountRole.READONLY;

    return signer
      ? { address: accountAddress, role, signer }
      : { address: accountAddress, role };
  });

  return { programAddress, accounts, data };
}

// Create a fresh in-memory validator and token accounts for each test.
async function createFixture() {
  const client = await createClient().use(generatedSigner()).use(litesvm());
  const maker = client.payer;
  const taker = await generateKeyPairSigner();

  // Load the compiled program and fund the maker for account creation.
  client.svm.addProgramFromFile(
    programAddress,
    "target/deploy/solana_escrow.so"
  );
  await client.airdrop(maker.address, lamports(10_000_000_000n));

  // Create two mints controlled by the maker.
  const mintA = await generateKeyPairSigner();
  const mintB = await generateKeyPairSigner();
  await client.sendTransaction(
    await getCreateMintInstructionPlan(client, {
      payer: maker,
      newMint: mintA,
      decimals: 0,
      mintAuthority: maker,
    })
  );
  await client.sendTransaction(
    await getCreateMintInstructionPlan(client, {
      payer: maker,
      newMint: mintB,
      decimals: 0,
      mintAuthority: maker,
    })
  );

  // Give the maker token A and the taker token B for the trade.
  await client.sendTransaction(
    await getMintToATAInstructionPlanAsync({
      payer: maker,
      owner: maker.address,
      mint: mintA.address,
      mintAuthority: maker,
      amount: 1_000n,
      decimals: 0,
    })
  );
  await client.sendTransaction(
    await getMintToATAInstructionPlanAsync({
      payer: maker,
      owner: taker.address,
      mint: mintB.address,
      mintAuthority: maker,
      amount: 1_000n,
      decimals: 0,
    })
  );

  // Create empty token accounts for the two recipients.
  await client.sendTransaction(
    await getCreateAssociatedTokenIdempotentInstructionAsync({
      payer: maker,
      owner: maker.address,
      mint: mintB.address,
    })
  );
  await client.sendTransaction(
    await getCreateAssociatedTokenIdempotentInstructionAsync({
      payer: maker,
      owner: taker.address,
      mint: mintA.address,
    })
  );

  const [makerTokenA] = await findAssociatedTokenPda({
    owner: maker.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: mintA.address,
  });
  const [makerTokenB] = await findAssociatedTokenPda({
    owner: maker.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: mintB.address,
  });
  const [takerTokenA] = await findAssociatedTokenPda({
    owner: taker.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: mintA.address,
  });
  const [takerTokenB] = await findAssociatedTokenPda({
    owner: taker.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: mintB.address,
  });

  // Derive the escrow PDA and its associated token A vault.
  const seed = 1n;
  const [escrow] = await getProgramDerivedAddress({
    programAddress,
    seeds: [
      getUtf8Encoder().encode("escrow"),
      getAddressEncoder().encode(maker.address),
      getU64Encoder().encode(seed),
    ],
  });
  const [vault] = await findAssociatedTokenPda({
    owner: escrow,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: mintA.address,
  });

  return {
    client,
    maker,
    taker,
    mintA: mintA.address,
    mintB: mintB.address,
    makerTokenA,
    makerTokenB,
    takerTokenA,
    takerTokenB,
    escrow,
    vault,
    seed,
  };
}

// Open an escrow using the shared test terms.
async function makeEscrow(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const { client, maker, mintA, mintB, makerTokenA, escrow, vault, seed } =
    fixture;
  await client.sendTransaction(
    makeInstruction(
      "make",
      {
        maker: maker.address,
        maker_token_a: makerTokenA,
        mint_a: mintA,
        mint_b: mintB,
        escrow,
        vault,
        token_program: TOKEN_PROGRAM_ADDRESS,
        associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
        system_program: SYSTEM_PROGRAM_ADDRESS,
        rent: rentAddress,
      },
      [seed, offeredAmount, requestedAmount],
      { maker }
    )
  );
}

describe("solana_escrow LiteSVM", () => {
  it("locks token A when the maker creates an escrow", async () => {
    const fixture = await createFixture();
    await makeEscrow(fixture);

    const vault = await fetchToken(fixture.client.rpc, fixture.vault);
    const makerBalance = await fetchToken(
      fixture.client.rpc,
      fixture.makerTokenA
    );

    expect(vault.data.amount).to.equal(offeredAmount);
    expect(makerBalance.data.amount).to.equal(1_000n - offeredAmount);
    expect(fixture.client.svm.getAccount(fixture.escrow).exists).to.equal(true);
  });

  it("lets a taker pay token B and receive token A", async () => {
    const fixture = await createFixture();
    await makeEscrow(fixture);

    // The taker signs the trade, and the token accounts belong to the right wallets.
    await fixture.client.sendTransaction(
      makeInstruction(
        "take",
        {
          taker: fixture.taker.address,
          maker: fixture.maker.address,
          escrow: fixture.escrow,
          taker_token_b: fixture.takerTokenB,
          maker_token_b: fixture.makerTokenB,
          taker_token_a: fixture.takerTokenA,
          vault: fixture.vault,
          token_program: TOKEN_PROGRAM_ADDRESS,
        },
        [],
        { taker: fixture.taker }
      )
    );

    const makerBalance = await fetchToken(
      fixture.client.rpc,
      fixture.makerTokenB
    );
    const takerTokenB = await fetchToken(
      fixture.client.rpc,
      fixture.takerTokenB
    );
    const takerTokenA = await fetchToken(
      fixture.client.rpc,
      fixture.takerTokenA
    );

    expect(makerBalance.data.amount).to.equal(requestedAmount);
    expect(takerTokenB.data.amount).to.equal(1_000n - requestedAmount);
    expect(takerTokenA.data.amount).to.equal(offeredAmount);
    expect(fixture.client.svm.getAccount(fixture.vault).exists).to.equal(false);
    expect(fixture.client.svm.getAccount(fixture.escrow).exists).to.equal(
      false
    );
  });

  it("returns token A to the maker on refund", async () => {
    const fixture = await createFixture();
    await makeEscrow(fixture);

    await fixture.client.sendTransaction(
      makeInstruction(
        "refund",
        {
          maker: fixture.maker.address,
          escrow: fixture.escrow,
          maker_token_a: fixture.makerTokenA,
          vault: fixture.vault,
          token_program: TOKEN_PROGRAM_ADDRESS,
        },
        [],
        { maker: fixture.maker }
      )
    );

    const makerBalance = await fetchToken(
      fixture.client.rpc,
      fixture.makerTokenA
    );
    expect(makerBalance.data.amount).to.equal(1_000n);
    expect(fixture.client.svm.getAccount(fixture.vault).exists).to.equal(false);
    expect(fixture.client.svm.getAccount(fixture.escrow).exists).to.equal(
      false
    );
  });

  it("lets the maker update the token B amount", async () => {
    const fixture = await createFixture();
    await makeEscrow(fixture);

    // Taking the escrow verifies that the new amount was saved.
    await fixture.client.sendTransaction(
      makeInstruction(
        "update",
        { maker: fixture.maker.address, escrow: fixture.escrow },
        [300n],
        { maker: fixture.maker }
      )
    );
    await fixture.client.sendTransaction(
      makeInstruction(
        "take",
        {
          taker: fixture.taker.address,
          maker: fixture.maker.address,
          escrow: fixture.escrow,
          taker_token_b: fixture.takerTokenB,
          maker_token_b: fixture.makerTokenB,
          taker_token_a: fixture.takerTokenA,
          vault: fixture.vault,
          token_program: TOKEN_PROGRAM_ADDRESS,
        },
        [],
        { taker: fixture.taker }
      )
    );

    const makerBalance = await fetchToken(
      fixture.client.rpc,
      fixture.makerTokenB
    );
    expect(makerBalance.data.amount).to.equal(300n);
  });

  it("rejects a refund signed by someone other than the maker", async () => {
    const fixture = await createFixture();
    await makeEscrow(fixture);
    const stranger = await generateKeyPairSigner();

    let failed = false;
    try {
      await fixture.client.sendTransaction(
        makeInstruction(
          "refund",
          {
            maker: stranger.address,
            escrow: fixture.escrow,
            maker_token_a: fixture.makerTokenA,
            vault: fixture.vault,
            token_program: TOKEN_PROGRAM_ADDRESS,
          },
          [],
          { maker: stranger }
        )
      );
    } catch (error) {
      failed = true;
      expect(error).to.exist;
    }

    // The failed refund must leave the token A vault untouched.
    expect(failed).to.equal(true);
    const vault = await fetchToken(fixture.client.rpc, fixture.vault);
    expect(vault.data.amount).to.equal(offeredAmount);
    expect(fixture.client.svm.getAccount(fixture.escrow).exists).to.equal(true);
  });
});
