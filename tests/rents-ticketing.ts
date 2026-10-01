import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

describe("rents-ticketing", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Adjust "RentsTicketing" to match the name in target/idl/*.json ("name" field)
  const program = anchor.workspace.RentsTicketing as Program;

  const METAPLEX_TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );

  const eventPda = (organizer: anchor.web3.PublicKey, eventId: anchor.BN) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("event"),
        organizer.toBuffer(),
        eventId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  const expectProgramError = async (
    action: Promise<unknown>,
    expectedCode: string
  ): Promise<void> => {
    let thrown = false;
    try {
      await action;
    } catch (error) {
      thrown = true;
      assert.include(String(error), expectedCode);
    }
    assert.isTrue(thrown, `Expected ${expectedCode} error`);
  };

  it("loads the Metaplex Token Metadata program and it is executable", async () => {
    const accountInfo = await provider.connection.getAccountInfo(
      METAPLEX_TOKEN_METADATA_PROGRAM_ID
    );
    assert.isNotNull(accountInfo, "Metaplex Token Metadata program account not found");
    assert.isTrue(accountInfo!.executable, "Metaplex Token Metadata program is not executable");
  });

  it("creates an event with the specified fields and bps values", async () => {
    const organizer = provider.wallet.publicKey;
    const eventId = new anchor.BN(1);
    const maxTickets = 25;
    const basePrice = new anchor.BN(2_500_000_000);
    const resaleCapBps = 11_000;
    const royaltyBps = 500;
    const [event, bump] = eventPda(organizer, eventId);

    await program.methods
      .initializeEvent(eventId, maxTickets, basePrice, resaleCapBps, royaltyBps)
      .accounts({
        organizer,
        event,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const stored = await program.account.event.fetch(event);
    assert.equal(stored.organizer.toBase58(), organizer.toBase58());
    assert.isTrue(stored.eventId.eq(eventId));
    assert.equal(stored.maxTickets, maxTickets);
    assert.equal(stored.ticketsSold, 0);
    assert.isTrue(stored.basePrice.eq(basePrice));
    assert.equal(stored.resaleCapBps, resaleCapBps);
    assert.equal(stored.royaltyBps, royaltyBps);
    assert.equal(stored.bump, bump);
  });

  it("rejects invalid event basis-point values", async () => {
    const organizer = provider.wallet.publicKey;
    const basePrice = new anchor.BN(1_000_000_000);
    const standardArgs = [10, basePrice] as const;

    const lowCapEventId = new anchor.BN(2);
    const [lowCapEvent] = eventPda(organizer, lowCapEventId);
    await expectProgramError(
      program.methods
        .initializeEvent(lowCapEventId, ...standardArgs, 9_999, 500)
        .accounts({
          organizer,
          event: lowCapEvent,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc(),
      "InvalidBps"
    );

    const highRoyaltyEventId = new anchor.BN(3);
    const [highRoyaltyEvent] = eventPda(organizer, highRoyaltyEventId);
    await expectProgramError(
      program.methods
        .initializeEvent(highRoyaltyEventId, ...standardArgs, 11_000, 2_001)
        .accounts({
          organizer,
          event: highRoyaltyEvent,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc(),
      "InvalidBps"
    );
  });

  it("rejects an event with zero maximum tickets", async () => {
    const organizer = provider.wallet.publicKey;
    const eventId = new anchor.BN(4);
    const [event] = eventPda(organizer, eventId);

    await expectProgramError(
      program.methods
        .initializeEvent(eventId, 0, new anchor.BN(1_000_000_000), 11_000, 500)
        .accounts({
          organizer,
          event,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc(),
      "InvalidMaxTickets"
    );
  });

  it("rejects initializing the same organizer and event ID twice", async () => {
    const organizer = provider.wallet.publicKey;
    const eventId = new anchor.BN(5);
    const [event] = eventPda(organizer, eventId);
    const initialize = () =>
      program.methods
        .initializeEvent(eventId, 10, new anchor.BN(1_000_000_000), 11_000, 500)
        .accounts({
          organizer,
          event,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

    await initialize();
    await expectProgramError(initialize(), "already in use");
  });

  it("initializes and updates the platform config with an admin fee", async () => {
    const admin = provider.wallet.publicKey;
    const platformWallet = anchor.web3.Keypair.generate().publicKey;
    const updatedPlatformWallet = anchor.web3.Keypair.generate().publicKey;
    const nonAdmin = anchor.web3.Keypair.generate();
    const [platformConfig] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("platform_config")],
      program.programId
    );
    const expectError = async (action: Promise<unknown>, expectedCode: string) => {
      try {
        await action;
        assert.fail(`Expected ${expectedCode} error`);
      } catch (error) {
        assert.include(String(error), expectedCode);
      }
    };

    await expectError(
      program.methods
        .initializePlatformConfig(platformWallet, 501)
        .accounts({ admin, platformConfig })
        .rpc(),
      "InvalidFee"
    );

    await program.methods
      .initializePlatformConfig(platformWallet, 100)
      .accounts({ admin, platformConfig })
      .rpc();

    const initialConfig = await program.account.platformConfig.fetch(platformConfig);
    assert.equal(initialConfig.platformFeeBps, 100);
    assert.equal(initialConfig.platformWallet.toBase58(), platformWallet.toBase58());

    await expectError(
      program.methods
        .initializePlatformConfig(platformWallet, 100)
        .accounts({ admin, platformConfig })
        .rpc(),
      "already in use"
    );

    await expectError(
      program.methods
        .updatePlatformWallet(updatedPlatformWallet)
        .accounts({ admin: nonAdmin.publicKey, platformConfig })
        .signers([nonAdmin])
        .rpc(),
      "NotAdmin"
    );
    await expectError(
      program.methods
        .updatePlatformFee(200)
        .accounts({ admin: nonAdmin.publicKey, platformConfig })
        .signers([nonAdmin])
        .rpc(),
      "NotAdmin"
    );
    await expectError(
      program.methods
        .updatePlatformFee(501)
        .accounts({ admin, platformConfig })
        .rpc(),
      "InvalidFee"
    );

    await program.methods
      .updatePlatformWallet(updatedPlatformWallet)
      .accounts({ admin, platformConfig })
      .rpc();
    await program.methods
      .updatePlatformFee(200)
      .accounts({ admin, platformConfig })
      .rpc();

    const config = await program.account.platformConfig.fetch(platformConfig);
    assert.equal(config.admin.toBase58(), admin.toBase58());
    assert.equal(config.platformWallet.toBase58(), updatedPlatformWallet.toBase58());
    assert.equal(config.platformFeeBps, 200);
  });
});
