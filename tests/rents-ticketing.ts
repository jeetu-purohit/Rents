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
  const platformWallet = anchor.web3.Keypair.generate().publicKey;
  const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  );
  const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
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

  const ticketPda = (mint: anchor.web3.PublicKey) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("ticket"), mint.toBuffer()],
      program.programId
    );

  const associatedTokenAddress = (
    owner: anchor.web3.PublicKey,
    mint: anchor.web3.PublicKey
  ) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [
        owner.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];

  const ticketAuthorityPda = () =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("authority")],
      program.programId
    )[0];

  const metadataPda = (mint: anchor.web3.PublicKey) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METAPLEX_TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      METAPLEX_TOKEN_METADATA_PROGRAM_ID
    )[0];

  const decodeMetadata = (data: Buffer) => {
    let offset = 1 + 32 + 32;
    const readString = (): string => {
      const length = data.readUInt32LE(offset);
      offset += 4;
      const value = data.toString("utf8", offset, offset + length).replace(/\0+$/, "");
      offset += length;
      return value;
    };
    const name = readString();
    const symbol = readString();
    const uri = readString();
    const sellerFeeBasisPoints = data.readUInt16LE(offset);
    offset += 2;
    const creatorOption = data[offset];
    offset += 1;
    const creators: anchor.web3.PublicKey[] = [];
    if (creatorOption === 1) {
      const creatorCount = data.readUInt32LE(offset);
      offset += 4;
      for (let index = 0; index < creatorCount; index += 1) {
        creators.push(new anchor.web3.PublicKey(data.subarray(offset, offset + 32)));
        offset += 34;
      }
    }
    return { name, symbol, uri, sellerFeeBasisPoints, creators };
  };

  const splInstruction = (
    tag: number,
    keys: anchor.web3.AccountMeta[],
    amount?: bigint
  ) => {
    const data = Buffer.alloc(amount === undefined ? 1 : 9);
    data[0] = tag;
    if (amount !== undefined) data.writeBigUInt64LE(amount, 1);
    return new anchor.web3.TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys,
      data,
    });
  };

  const createAssociatedTokenAccountInstruction = (
    payer: anchor.web3.PublicKey,
    owner: anchor.web3.PublicKey,
    mint: anchor.web3.PublicKey,
    address: anchor.web3.PublicKey
  ) =>
    new anchor.web3.TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: address, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([0]),
    });

  const expectTransactionFailure = async (
    transaction: anchor.web3.Transaction,
    signers: anchor.web3.Keypair[] = []
  ): Promise<void> => {
    let failed = false;
    try {
      await provider.sendAndConfirm(transaction, signers);
    } catch {
      failed = true;
    }
    assert.isTrue(failed, "Expected the SPL token transaction to fail");
  };

  const platformConfigPda = () =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("platform_config")],
      program.programId
    )[0];

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

  const setProgramAccountData = async (
    address: anchor.web3.PublicKey,
    owner: anchor.web3.PublicKey,
    data: Buffer
  ): Promise<void> => {
    const accountInfo = await provider.connection.getAccountInfo(address);
    assert.isNotNull(accountInfo);
    const response = await fetch(provider.connection.rpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "surfnet_setAccount",
        params: [
          address.toBase58(),
          {
            data: data.toString("hex"),
            executable: false,
            lamports: accountInfo!.lamports,
            owner: owner.toBase58(),
            rentEpoch: accountInfo!.rentEpoch,
          },
        ],
      }),
    });
    const result = (await response.json()) as { error?: { message: string } };
    assert.isUndefined(result.error, result.error?.message);
  };

  const createResaleFixture = async (eventIdNumber: number) => {
    const organizer = anchor.web3.Keypair.generate();
    const seller = anchor.web3.Keypair.generate();
    const eventId = new anchor.BN(eventIdNumber);
    const faceValue = new anchor.BN(anchor.web3.LAMPORTS_PER_SOL);
    const [event] = eventPda(organizer.publicKey, eventId);
    for (const [keypair, lamports] of [
      [organizer, 2 * anchor.web3.LAMPORTS_PER_SOL],
      [seller, 3 * anchor.web3.LAMPORTS_PER_SOL],
    ] as const) {
      const signature = await provider.connection.requestAirdrop(keypair.publicKey, lamports);
      await provider.connection.confirmTransaction(signature, "confirmed");
    }
    await program.methods
      .initializeEvent(eventId, 10, faceValue, 11_000, 500)
      .accounts({
        organizer: organizer.publicKey,
        event,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([organizer])
      .rpc();

    const mint = anchor.web3.Keypair.generate();
    const [ticket] = ticketPda(mint.publicKey);
    const sellerTokenAccount = associatedTokenAddress(seller.publicKey, mint.publicKey);
    await program.methods
      .mintTicket(`Resale Event ${eventIdNumber}`, `https://example.test/resale/${eventIdNumber}.json`)
      .accounts({
        buyer: seller.publicKey,
        event,
        organizer: organizer.publicKey,
        platformConfig: platformConfigPda(),
        platformWallet,
        ticketAuthority: ticketAuthorityPda(),
        mint: mint.publicKey,
        ticket,
        buyerTokenAccount: sellerTokenAccount,
        metadata: metadataPda(mint.publicKey),
        tokenMetadataProgram: METAPLEX_TOKEN_METADATA_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([seller, mint])
      .rpc();

    return { organizer, seller, event, ticket, mint, sellerTokenAccount, faceValue };
  };

  const checkInAccounts = (
    organizer: anchor.web3.PublicKey,
    event: anchor.web3.PublicKey,
    ticket: anchor.web3.PublicKey,
    mint: anchor.web3.PublicKey,
    holder: anchor.web3.PublicKey,
    tokenAccount: anchor.web3.PublicKey
  ) => ({
    organizer,
    event,
    ticket,
    mint,
    holder,
    tokenAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
  });

  const clockUnixTimestamp = async (): Promise<bigint> => {
    const clockInfo = await provider.connection.getAccountInfo(anchor.web3.SYSVAR_CLOCK_PUBKEY);
    assert.isNotNull(clockInfo);
    return clockInfo!.data.readBigInt64LE(32);
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
      .updatePlatformFee(100)
      .accounts({ admin, platformConfig })
      .rpc();
    await program.methods
      .updatePlatformWallet(platformWallet)
      .accounts({ admin, platformConfig })
      .rpc();

    const config = await program.account.platformConfig.fetch(platformConfig);
    assert.equal(config.admin.toBase58(), admin.toBase58());
    assert.equal(config.platformWallet.toBase58(), platformWallet.toBase58());
    assert.equal(config.platformFeeBps, 100);
  });

  it("mints sequential tickets and pays the organizer and platform in exact amounts", async () => {
    const organizer = anchor.web3.Keypair.generate();
    const buyer = anchor.web3.Keypair.generate();
    const eventId = new anchor.BN(21);
    const eventName = "Solana Fall School";
    const uri = "https://example.test/metadata/solana-fall-school.json";
    const basePrice = new anchor.BN(10_000_000);
    const fee = 100_000;
    const [event] = eventPda(organizer.publicKey, eventId);

    for (const keypair of [organizer, buyer]) {
      const signature = await provider.connection.requestAirdrop(
        keypair.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature, "confirmed");
    }
    const platformFunding = await provider.connection.requestAirdrop(
      platformWallet,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(platformFunding, "confirmed");

    await program.methods
      .initializeEvent(eventId, 2, basePrice, 11_000, 500)
      .accounts({
        organizer: organizer.publicKey,
        event,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([organizer])
      .rpc();

    const organizerBefore = await provider.connection.getBalance(organizer.publicKey);
    const platformBefore = await provider.connection.getBalance(platformWallet);
    const buyerBefore = await provider.connection.getBalance(buyer.publicKey);
    let accountRentTotal = 0;
    const minted: Array<{ mint: anchor.web3.Keypair; ticket: anchor.web3.PublicKey }> = [];

    for (let index = 0; index < 2; index += 1) {
      const mint = anchor.web3.Keypair.generate();
      const [ticket] = ticketPda(mint.publicKey);
      const buyerTokenAccount = associatedTokenAddress(buyer.publicKey, mint.publicKey);
      await program.methods
        .mintTicket(eventName, uri)
        .accounts({
          buyer: buyer.publicKey,
          event,
          organizer: organizer.publicKey,
          platformConfig: platformConfigPda(),
          platformWallet,
          ticketAuthority: ticketAuthorityPda(),
          mint: mint.publicKey,
          ticket,
          buyerTokenAccount,
          metadata: metadataPda(mint.publicKey),
          tokenMetadataProgram: METAPLEX_TOKEN_METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([buyer, mint])
        .rpc();
      minted.push({ mint, ticket });

      const storedTicket = await program.account.ticket.fetch(ticket);
      assert.equal(storedTicket.event.toBase58(), event.toBase58());
      assert.equal(storedTicket.mint.toBase58(), mint.publicKey.toBase58());
      assert.equal(storedTicket.ticketNumber, index + 1);
      assert.isTrue(storedTicket.faceValue.eq(basePrice));
      assert.isFalse(storedTicket.isUsed);
      assert.equal(storedTicket.usedAt.toString(), "0");
      assert.isNull(storedTicket.listingPrice);
      assert.equal(storedTicket.resaleCount, 0);

      const mintInfo = await provider.connection.getAccountInfo(mint.publicKey);
      assert.isNotNull(mintInfo);
      assert.equal(mintInfo!.owner.toBase58(), TOKEN_PROGRAM_ID.toBase58());
      assert.equal(mintInfo!.data[44], 0, "mint decimals must be zero");
      assert.equal(mintInfo!.data.readBigUInt64LE(36), 1n, "mint supply must be one");
      assert.equal(mintInfo!.data.readUInt32LE(0), 0, "mint authority must be revoked");
      assert.equal(mintInfo!.data.readUInt32LE(46), 1, "freeze authority must be set");
      assert.equal(
        new anchor.web3.PublicKey(mintInfo!.data.subarray(50, 82)).toBase58(),
        ticketAuthorityPda().toBase58()
      );

      const tokenInfo = await provider.connection.getAccountInfo(buyerTokenAccount);
      assert.isNotNull(tokenInfo);
      assert.equal(tokenInfo!.owner.toBase58(), TOKEN_PROGRAM_ID.toBase58());
      assert.equal(tokenInfo!.data.readBigUInt64LE(64), 1n);
      assert.equal(
        new anchor.web3.PublicKey(tokenInfo!.data.subarray(32, 64)).toBase58(),
        buyer.publicKey.toBase58()
      );
      assert.equal(tokenInfo!.data[108], 2, "buyer token account must be frozen");
      assert.equal(tokenInfo!.data.readUInt32LE(72), 1, "delegate must be set");
      assert.equal(
        new anchor.web3.PublicKey(tokenInfo!.data.subarray(76, 108)).toBase58(),
        ticketAuthorityPda().toBase58()
      );
      assert.equal(tokenInfo!.data.readBigUInt64LE(121), 1n);

      const metadataInfo = await provider.connection.getAccountInfo(
        metadataPda(mint.publicKey)
      );
      assert.isNotNull(metadataInfo, "Metaplex metadata account must exist");
      assert.equal(
        metadataInfo!.owner.toBase58(),
        METAPLEX_TOKEN_METADATA_PROGRAM_ID.toBase58()
      );
      assert.equal(metadataInfo!.data[0], 4, "metadata account must be MetadataV1");
      const metadata = decodeMetadata(metadataInfo!.data);
      assert.equal(metadata.name, `${eventName} #${index + 1}`);
      assert.equal(metadata.symbol, "RENTS");
      assert.equal(metadata.uri, uri);
      assert.equal(metadata.sellerFeeBasisPoints, 500);
      assert.deepEqual(metadata.creators.map((creator) => creator.toBase58()), [
        organizer.publicKey.toBase58(),
      ]);
      const ticketInfo = await provider.connection.getAccountInfo(ticket);
      assert.isNotNull(ticketInfo);
      accountRentTotal +=
        mintInfo!.lamports + ticketInfo!.lamports + tokenInfo!.lamports + metadataInfo!.lamports;

      const eventState = await program.account.event.fetch(event);
      assert.equal(eventState.ticketsSold, index + 1);
    }

    assert.equal(
      (await provider.connection.getBalance(organizer.publicKey)) - organizerBefore,
      2 * basePrice.toNumber()
    );
    assert.equal(
      (await provider.connection.getBalance(platformWallet)) - platformBefore,
      2 * fee
    );
    const buyerDebit = buyerBefore - (await provider.connection.getBalance(buyer.publicKey));
    const expectedBuyerDebit = 2 * (basePrice.toNumber() + fee) + accountRentTotal;
    assert.isAtLeast(buyerDebit, expectedBuyerDebit);
    assert.isAtMost(
      buyerDebit,
      expectedBuyerDebit + 100_000,
      "any additional buyer debit should be limited to normal transaction fees"
    );
    assert.notEqual(minted[0].ticket.toBase58(), minted[1].ticket.toBase58());

    const firstMint = minted[0].mint;
    const source = associatedTokenAddress(buyer.publicKey, firstMint.publicKey);
    const recipient = anchor.web3.Keypair.generate();
    const destination = associatedTokenAddress(recipient.publicKey, firstMint.publicKey);
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          recipient.publicKey,
          firstMint.publicKey,
          destination
        )
      ),
      []
    );

    const transferByBuyer = splInstruction(
      3,
      [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: buyer.publicKey, isSigner: true, isWritable: false },
      ],
      1n
    );
    await expectTransactionFailure(
      new anchor.web3.Transaction().add(transferByBuyer),
      [buyer]
    );

    const unrelatedSigner = anchor.web3.Keypair.generate();
    const transferByUnrelatedSigner = splInstruction(
      3,
      [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: unrelatedSigner.publicKey, isSigner: true, isWritable: false },
      ],
      1n
    );
    await expectTransactionFailure(
      new anchor.web3.Transaction().add(transferByUnrelatedSigner),
      [unrelatedSigner]
    );

    const owner = { pubkey: buyer.publicKey, isSigner: true, isWritable: false };
    await expectTransactionFailure(
      new anchor.web3.Transaction().add(
        splInstruction(5, [{ pubkey: source, isSigner: false, isWritable: true }, owner])
      ),
      [buyer]
    );
    await expectTransactionFailure(
      new anchor.web3.Transaction().add(
        splInstruction(
          4,
          [
            { pubkey: source, isSigner: false, isWritable: true },
            { pubkey: unrelatedSigner.publicKey, isSigner: false, isWritable: false },
            owner,
          ],
          1n
        )
      ),
      [buyer]
    );
    await expectTransactionFailure(
      new anchor.web3.Transaction().add(
        splInstruction(
          8,
          [
            { pubkey: source, isSigner: false, isWritable: true },
            { pubkey: firstMint.publicKey, isSigner: false, isWritable: true },
            owner,
          ],
          1n
        )
      ),
      [buyer]
    );
    await expectTransactionFailure(
      new anchor.web3.Transaction().add(
        splInstruction(9, [
          { pubkey: source, isSigner: false, isWritable: true },
          { pubkey: buyer.publicKey, isSigner: false, isWritable: true },
          owner,
        ])
      ),
      [buyer]
    );

    const sourceAfterFailures = await provider.connection.getAccountInfo(source);
    const destinationAfterFailures = await provider.connection.getAccountInfo(destination);
    const mintAfterFailures = await provider.connection.getAccountInfo(firstMint.publicKey);
    assert.isNotNull(sourceAfterFailures, "frozen buyer ATA must remain open");
    assert.equal(sourceAfterFailures!.data.readBigUInt64LE(64), 1n);
    assert.equal(sourceAfterFailures!.data[108], 2);
    assert.isNotNull(destinationAfterFailures);
    assert.equal(destinationAfterFailures!.data.readBigUInt64LE(64), 0n);
    assert.isNotNull(mintAfterFailures);
    assert.equal(mintAfterFailures!.data.readBigUInt64LE(36), 1n);
    const [masterEdition] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METAPLEX_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        firstMint.publicKey.toBuffer(),
        Buffer.from("edition"),
      ],
      METAPLEX_TOKEN_METADATA_PROGRAM_ID
    );
    assert.isNull(
      await provider.connection.getAccountInfo(masterEdition),
      "mint must not have a Master Edition"
    );
  });

  it("lists and cancels a frozen ticket with exact cap and holder checks", async () => {
    const organizer = anchor.web3.Keypair.generate();
    const holder = anchor.web3.Keypair.generate();
    const nonHolder = anchor.web3.Keypair.generate();
    const eventId = new anchor.BN(24);
    const otherEventId = new anchor.BN(25);
    const faceValue = new anchor.BN(1_000_000_001);
    const resaleCapBps = 11_000;
    const cap = new anchor.BN(1_100_000_001);
    const [event] = eventPda(organizer.publicKey, eventId);
    const [otherEvent] = eventPda(organizer.publicKey, otherEventId);

    for (const keypair of [organizer, holder, nonHolder]) {
      const signature = await provider.connection.requestAirdrop(
        keypair.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature, "confirmed");
    }

    for (const [id, pda] of [
      [eventId, event],
      [otherEventId, otherEvent],
    ] as const) {
      await program.methods
        .initializeEvent(id, 5, faceValue, resaleCapBps, 500)
        .accounts({
          organizer: organizer.publicKey,
          event: pda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([organizer])
        .rpc();
    }

    const mint = anchor.web3.Keypair.generate();
    const [ticket] = ticketPda(mint.publicKey);
    const tokenAccount = associatedTokenAddress(holder.publicKey, mint.publicKey);
    await program.methods
      .mintTicket("Solana Fall School", "https://example.test/listing.json")
      .accounts({
        buyer: holder.publicKey,
        event,
        organizer: organizer.publicKey,
        platformConfig: platformConfigPda(),
        platformWallet,
        ticketAuthority: ticketAuthorityPda(),
        mint: mint.publicKey,
        ticket,
        buyerTokenAccount: tokenAccount,
        metadata: metadataPda(mint.publicKey),
        tokenMetadataProgram: METAPLEX_TOKEN_METADATA_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([holder, mint])
      .rpc();

    const listingAccounts = { holder: holder.publicKey, event, ticket, tokenAccount };
    const listingErrorAccounts = { ...listingAccounts, holder: nonHolder.publicKey };
    const originalTicket = await program.account.ticket.fetch(ticket);
    const originalTokenAccount = await provider.connection.getAccountInfo(tokenAccount);
    assert.isNotNull(originalTokenAccount);
    assert.equal(originalTokenAccount!.data.readBigUInt64LE(64), 1n);
    assert.equal(originalTokenAccount!.data[108], 2, "ticket must start frozen");

    await program.methods
      .listTicket(cap.subn(1))
      .accounts(listingAccounts)
      .signers([holder])
      .rpc();
    assert.isTrue((await program.account.ticket.fetch(ticket)).listingPrice.eq(cap.subn(1)));

    await program.methods
      .listTicket(cap)
      .accounts(listingAccounts)
      .signers([holder])
      .rpc();
    assert.isTrue((await program.account.ticket.fetch(ticket)).listingPrice.eq(cap));

    await expectProgramError(
      program.methods
        .listTicket(cap.addn(1))
        .accounts(listingAccounts)
        .signers([holder])
        .rpc(),
      "PriceExceedsCap"
    );
    await expectProgramError(
      program.methods
        .listTicket(new anchor.BN(0))
        .accounts(listingAccounts)
        .signers([holder])
        .rpc(),
      "InvalidPrice"
    );
    await expectProgramError(
      program.methods
        .listTicket(new anchor.BN(100))
        .accounts(listingErrorAccounts)
        .signers([nonHolder])
        .rpc(),
      "NotTicketHolder"
    );
    await expectProgramError(
      program.methods
        .listTicket(new anchor.BN(100))
        .accounts({ ...listingAccounts, event: otherEvent })
        .signers([holder])
        .rpc(),
      "WrongEvent"
    );
    await expectProgramError(
      program.methods
        .cancelListing()
        .accounts({ ...listingAccounts, holder: nonHolder.publicKey })
        .signers([nonHolder])
        .rpc(),
      "NotTicketHolder"
    );

    const updatedPrice = cap.subn(7);
    await program.methods
      .listTicket(updatedPrice)
      .accounts(listingAccounts)
      .signers([holder])
      .rpc();
    assert.isTrue(
      (await program.account.ticket.fetch(ticket)).listingPrice.eq(updatedPrice),
      "listing an already-listed ticket must update its price"
    );

    await program.methods
      .cancelListing()
      .accounts(listingAccounts)
      .signers([holder])
      .rpc();
    const cancelledTicket = await program.account.ticket.fetch(ticket);
    assert.isNull(cancelledTicket.listingPrice);
    assert.equal(cancelledTicket.ticketNumber, originalTicket.ticketNumber);
    assert.isTrue(cancelledTicket.faceValue.eq(originalTicket.faceValue));
    assert.equal(cancelledTicket.resaleCount, originalTicket.resaleCount);
    assert.equal(cancelledTicket.isUsed, originalTicket.isUsed);
    assert.equal(cancelledTicket.usedAt.toString(), originalTicket.usedAt.toString());

    const tokenAccountAfter = await provider.connection.getAccountInfo(tokenAccount);
    assert.isNotNull(tokenAccountAfter);
    assert.equal(tokenAccountAfter!.data.readBigUInt64LE(64), 1n);
    assert.equal(tokenAccountAfter!.data[108], 2, "listing and cancellation must leave it frozen");
    assert.equal(
      tokenAccountAfter!.data.subarray(32, 64).toString("hex"),
      originalTokenAccount!.data.subarray(32, 64).toString("hex"),
      "listing and cancellation must not change the token-account owner"
    );
    assert.deepEqual(
      tokenAccountAfter!.data,
      originalTokenAccount!.data,
      "listing and cancellation must not change token-account state"
    );

    const setTokenAccount = async (amount: number) => {
      const response = await fetch(provider.connection.rpcEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "surfnet_setTokenAccount",
          params: [
            holder.publicKey.toBase58(),
            mint.publicKey.toBase58(),
            { amount },
            TOKEN_PROGRAM_ID.toBase58(),
          ],
        }),
      });
      const result = (await response.json()) as { error?: { message: string } };
      assert.isUndefined(result.error, result.error?.message);
    };
    await setTokenAccount(2);
    await expectProgramError(
      program.methods
        .listTicket(new anchor.BN(100))
        .accounts(listingAccounts)
        .signers([holder])
        .rpc(),
      "NotTicketHolder"
    );
    await setTokenAccount(1);

    // Surfpool's documented state cheatcode marks this minted ticket as used to exercise the guard;
    // the check-in instruction is intentionally outside Task 2.3.
    const ticketInfo = await provider.connection.getAccountInfo(ticket);
    assert.isNotNull(ticketInfo);
    const usedTicketData = Buffer.from(ticketInfo!.data);
    usedTicketData[84] = 1;
    const setAccountResponse = await fetch(provider.connection.rpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "surfnet_setAccount",
        params: [
          ticket.toBase58(),
          {
            data: usedTicketData.toString("hex"),
            executable: false,
            lamports: ticketInfo!.lamports,
            owner: program.programId.toBase58(),
            rentEpoch: ticketInfo!.rentEpoch,
          },
        ],
      }),
    });
    const setAccountResult = (await setAccountResponse.json()) as {
      error?: { message: string };
    };
    assert.isUndefined(setAccountResult.error, setAccountResult.error?.message);
    await expectProgramError(
      program.methods
        .listTicket(new anchor.BN(100))
        .accounts(listingAccounts)
        .signers([holder])
        .rpc(),
      "TicketAlreadyUsed"
    );
  });

  it("resells at the cap, keeps the buyer locked, and supports a rounded two-hop resale", async () => {
    const fixture = await createResaleFixture(31);
    const buyer = anchor.web3.Keypair.generate();
    const nextBuyer = anchor.web3.Keypair.generate();
    for (const keypair of [buyer, nextBuyer]) {
      const signature = await provider.connection.requestAirdrop(
        keypair.publicKey,
        3 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature, "confirmed");
    }

    const buyerTokenAccount = associatedTokenAddress(buyer.publicKey, fixture.mint.publicKey);
    const nextBuyerTokenAccount = associatedTokenAddress(nextBuyer.publicKey, fixture.mint.publicKey);
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          buyer.publicKey,
          fixture.mint.publicKey,
          buyerTokenAccount
        ),
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          nextBuyer.publicKey,
          fixture.mint.publicKey,
          nextBuyerTokenAccount
        )
      ),
      []
    );
    const resaleAccounts = (
      currentSeller: anchor.web3.Keypair,
      currentSellerTokenAccount: anchor.web3.PublicKey,
      currentBuyer: anchor.web3.Keypair,
      currentBuyerTokenAccount: anchor.web3.PublicKey
    ) => ({
      buyer: currentBuyer.publicKey,
      event: fixture.event,
      ticket: fixture.ticket,
      organizer: fixture.organizer.publicKey,
      seller: currentSeller.publicKey,
      platformConfig: platformConfigPda(),
      platformWallet,
      ticketAuthority: ticketAuthorityPda(),
      mint: fixture.mint.publicKey,
      sellerTokenAccount: currentSellerTokenAccount,
      buyerTokenAccount: currentBuyerTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    });

    const capPrice = new anchor.BN(1_100_000_000);
    await program.methods
      .listTicket(capPrice)
      .accounts({
        holder: fixture.seller.publicKey,
        event: fixture.event,
        ticket: fixture.ticket,
        tokenAccount: fixture.sellerTokenAccount,
      })
      .signers([fixture.seller])
      .rpc();

    const buyerBefore = await provider.connection.getBalance(buyer.publicKey);
    const organizerBefore = await provider.connection.getBalance(fixture.organizer.publicKey);
    const sellerBefore = await provider.connection.getBalance(fixture.seller.publicKey);
    const platformBefore = await provider.connection.getBalance(platformWallet);
    await program.methods
      .resellTicket()
      .accounts(resaleAccounts(fixture.seller, fixture.sellerTokenAccount, buyer, buyerTokenAccount))
      .signers([buyer])
      .rpc();

    assert.equal(buyerBefore - (await provider.connection.getBalance(buyer.publicKey)), 1_111_000_000);
    assert.equal(
      (await provider.connection.getBalance(fixture.organizer.publicKey)) - organizerBefore,
      55_000_000,
      "organizer receives 0.055 SOL royalty"
    );
    assert.equal(
      (await provider.connection.getBalance(fixture.seller.publicKey)) - sellerBefore,
      1_045_000_000,
      "seller receives 1.045 SOL"
    );
    assert.equal(
      (await provider.connection.getBalance(platformWallet)) - platformBefore,
      11_000_000,
      "platform receives 0.011 SOL"
    );
    let ticketState = await program.account.ticket.fetch(fixture.ticket);
    assert.isNull(ticketState.listingPrice);
    assert.equal(ticketState.resaleCount, 1);
    const buyerTokenInfo = await provider.connection.getAccountInfo(buyerTokenAccount);
    const sellerTokenInfo = await provider.connection.getAccountInfo(fixture.sellerTokenAccount);
    assert.isNotNull(buyerTokenInfo);
    assert.isNotNull(sellerTokenInfo);
    assert.equal(buyerTokenInfo!.data.readBigUInt64LE(64), 1n);
    assert.equal(buyerTokenInfo!.data[108], 2, "new owner token account is frozen");
    assert.equal(buyerTokenInfo!.data.readUInt32LE(72), 1, "TicketAuthority remains delegate");
    assert.equal(
      new anchor.web3.PublicKey(buyerTokenInfo!.data.subarray(76, 108)).toBase58(),
      ticketAuthorityPda().toBase58()
    );
    assert.equal(buyerTokenInfo!.data.readBigUInt64LE(121), 1n);
    assert.equal(
      new anchor.web3.PublicKey(buyerTokenInfo!.data.subarray(32, 64)).toBase58(),
      buyer.publicKey.toBase58()
    );
    const mintInfoAfterResale = await provider.connection.getAccountInfo(fixture.mint.publicKey);
    assert.isNotNull(mintInfoAfterResale);
    assert.equal(mintInfoAfterResale!.data.readUInt32LE(0), 0, "mint authority stays revoked");
    assert.equal(mintInfoAfterResale!.data.readUInt32LE(46), 1);
    assert.equal(
      new anchor.web3.PublicKey(mintInfoAfterResale!.data.subarray(50, 82)).toBase58(),
      ticketAuthorityPda().toBase58()
    );
    assert.equal(sellerTokenInfo!.data.readBigUInt64LE(64), 0n);
    assert.equal(sellerTokenInfo!.data[108], 1, "old owner token account is thawed");
    assert.equal(sellerTokenInfo!.data.readBigUInt64LE(121), 0n);

    const thirdParty = anchor.web3.Keypair.generate();
    const thirdPartyTokenAccount = associatedTokenAddress(
      thirdParty.publicKey,
      fixture.mint.publicKey
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          thirdParty.publicKey,
          fixture.mint.publicKey,
          thirdPartyTokenAccount
        )
      ),
      []
    );
    const transferByBuyer = splInstruction(
      3,
      [
        { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: thirdPartyTokenAccount, isSigner: false, isWritable: true },
        { pubkey: buyer.publicKey, isSigner: true, isWritable: false },
      ],
      1n
    );
    await expectTransactionFailure(
      new anchor.web3.Transaction().add(transferByBuyer),
      [buyer]
    );

    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        splInstruction(9, [
          { pubkey: fixture.sellerTokenAccount, isSigner: false, isWritable: true },
          { pubkey: fixture.seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: fixture.seller.publicKey, isSigner: true, isWritable: false },
        ])
      ),
      [fixture.seller]
    );
    assert.isNull(await provider.connection.getAccountInfo(fixture.sellerTokenAccount));

    const lowerPrice = new anchor.BN(900_000_003);
    await program.methods
      .listTicket(lowerPrice)
      .accounts({
        holder: buyer.publicKey,
        event: fixture.event,
        ticket: fixture.ticket,
        tokenAccount: buyerTokenAccount,
      })
      .signers([buyer])
      .rpc();
    const nextBuyerBefore = await provider.connection.getBalance(nextBuyer.publicKey);
    const organizerBeforeSecondSale = await provider.connection.getBalance(
      fixture.organizer.publicKey
    );
    const buyerBeforeSecondSale = await provider.connection.getBalance(buyer.publicKey);
    const platformBeforeSecondSale = await provider.connection.getBalance(platformWallet);
    await program.methods
      .resellTicket()
      .accounts(resaleAccounts(buyer, buyerTokenAccount, nextBuyer, nextBuyerTokenAccount))
      .signers([nextBuyer])
      .rpc();

    const royalty = 45_000_000;
    const sellerProceeds = 855_000_003;
    const fee = 9_000_000;
    assert.equal(nextBuyerBefore - (await provider.connection.getBalance(nextBuyer.publicKey)), 909_000_003);
    assert.equal(
      (await provider.connection.getBalance(fixture.organizer.publicKey)) - organizerBeforeSecondSale,
      royalty
    );
    assert.equal(
      (await provider.connection.getBalance(buyer.publicKey)) - buyerBeforeSecondSale,
      sellerProceeds
    );
    assert.equal(
      (await provider.connection.getBalance(platformWallet)) - platformBeforeSecondSale,
      fee
    );
    assert.equal(royalty + sellerProceeds, lowerPrice.toNumber());
    assert.equal(lowerPrice.toNumber() * 500 % 10_000, 1_500);
    assert.equal(lowerPrice.toNumber() * 100 % 10_000, 300);

    ticketState = await program.account.ticket.fetch(fixture.ticket);
    assert.isNull(ticketState.listingPrice);
    assert.equal(ticketState.resaleCount, 2);
    const nextBuyerTokenInfo = await provider.connection.getAccountInfo(nextBuyerTokenAccount);
    const secondSellerTokenInfo = await provider.connection.getAccountInfo(buyerTokenAccount);
    assert.isNotNull(nextBuyerTokenInfo);
    assert.isNotNull(secondSellerTokenInfo);
    assert.equal(nextBuyerTokenInfo!.data.readBigUInt64LE(64), 1n);
    assert.equal(nextBuyerTokenInfo!.data[108], 2);
    assert.equal(
      new anchor.web3.PublicKey(nextBuyerTokenInfo!.data.subarray(32, 64)).toBase58(),
      nextBuyer.publicKey.toBase58()
    );
    assert.equal(secondSellerTokenInfo!.data.readBigUInt64LE(64), 0n);
    assert.equal(secondSellerTokenInfo!.data[108], 1);
  });

  it("rejects invalid resale state, rechecks the cap, and rolls back an underfunded purchase", async () => {
    const fixture = await createResaleFixture(32);
    const buyer = anchor.web3.Keypair.generate();
    const buyerFunding = await provider.connection.requestAirdrop(
      buyer.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(buyerFunding, "confirmed");
    const buyerTokenAccount = associatedTokenAddress(buyer.publicKey, fixture.mint.publicKey);
    const accountsFor = (currentBuyer: anchor.web3.Keypair) => ({
      buyer: currentBuyer.publicKey,
      event: fixture.event,
      ticket: fixture.ticket,
      organizer: fixture.organizer.publicKey,
      seller: fixture.seller.publicKey,
      platformConfig: platformConfigPda(),
      platformWallet,
      ticketAuthority: ticketAuthorityPda(),
      mint: fixture.mint.publicKey,
      sellerTokenAccount: fixture.sellerTokenAccount,
      buyerTokenAccount: associatedTokenAddress(currentBuyer.publicKey, fixture.mint.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    });
    const validPrice = new anchor.BN(1_000_000_000);
    await expectProgramError(
      program.methods
        .resellTicket()
        .accounts(accountsFor(buyer))
        .signers([buyer])
        .rpc(),
      "NotListed"
    );
    await expectProgramError(
      program.methods
        .listTicket(new anchor.BN(1_100_000_001))
        .accounts({
          holder: fixture.seller.publicKey,
          event: fixture.event,
          ticket: fixture.ticket,
          tokenAccount: fixture.sellerTokenAccount,
        })
        .signers([fixture.seller])
        .rpc(),
      "PriceExceedsCap"
    );
    await program.methods
      .listTicket(validPrice)
      .accounts({
        holder: fixture.seller.publicKey,
        event: fixture.event,
        ticket: fixture.ticket,
        tokenAccount: fixture.sellerTokenAccount,
      })
      .signers([fixture.seller])
      .rpc();

    await expectProgramError(
      program.methods
        .resellTicket()
        .accounts({ ...accountsFor(fixture.seller), buyerTokenAccount: fixture.sellerTokenAccount })
        .signers([fixture.seller])
        .rpc(),
      "SelfPurchase"
    );

    const capExceededTicketData = Buffer.from(
      (await provider.connection.getAccountInfo(fixture.ticket))!.data
    );
    capExceededTicketData[93] = 1;
    capExceededTicketData.writeBigUInt64LE(1_100_000_001n, 94);
    await setProgramAccountData(fixture.ticket, program.programId, capExceededTicketData);
    await expectProgramError(
      program.methods
        .resellTicket()
        .accounts(accountsFor(buyer))
        .signers([buyer])
        .rpc(),
      "PriceExceedsCap"
    );

    await program.methods
      .listTicket(validPrice)
      .accounts({
        holder: fixture.seller.publicKey,
        event: fixture.event,
        ticket: fixture.ticket,
        tokenAccount: fixture.sellerTokenAccount,
      })
      .signers([fixture.seller])
      .rpc();
    const usedTicketData = Buffer.from(
      (await provider.connection.getAccountInfo(fixture.ticket))!.data
    );
    usedTicketData[84] = 1;
    await setProgramAccountData(fixture.ticket, program.programId, usedTicketData);
    await expectProgramError(
      program.methods
        .resellTicket()
        .accounts(accountsFor(buyer))
        .signers([buyer])
        .rpc(),
      "TicketAlreadyUsed"
    );

    usedTicketData[84] = 0;
    await setProgramAccountData(fixture.ticket, program.programId, usedTicketData);
    const poorBuyer = anchor.web3.Keypair.generate();
    const poorBuyerFunding = await provider.connection.requestAirdrop(poorBuyer.publicKey, 50_000_000);
    await provider.connection.confirmTransaction(poorBuyerFunding, "confirmed");
    const organizerBefore = await provider.connection.getBalance(fixture.organizer.publicKey);
    const sellerBefore = await provider.connection.getBalance(fixture.seller.publicKey);
    const platformBefore = await provider.connection.getBalance(platformWallet);
    const poorBuyerBefore = await provider.connection.getBalance(poorBuyer.publicKey);
    let failed = false;
    try {
      await program.methods
        .resellTicket()
        .accounts(accountsFor(poorBuyer))
        .signers([poorBuyer])
        .rpc();
    } catch {
      failed = true;
    }
    assert.isTrue(failed, "underfunded resale must fail");
    assert.equal(await provider.connection.getBalance(fixture.organizer.publicKey), organizerBefore);
    assert.equal(await provider.connection.getBalance(fixture.seller.publicKey), sellerBefore);
    assert.equal(await provider.connection.getBalance(platformWallet), platformBefore);
    assert.equal(await provider.connection.getBalance(poorBuyer.publicKey), poorBuyerBefore);
    const ticketState = await program.account.ticket.fetch(fixture.ticket);
    assert.isTrue(ticketState.listingPrice.eq(validPrice));
    assert.equal(ticketState.resaleCount, 0);
    assert.isNull(await provider.connection.getAccountInfo(associatedTokenAddress(poorBuyer.publicKey, fixture.mint.publicKey)));
    const sellerTokenInfo = await provider.connection.getAccountInfo(fixture.sellerTokenAccount);
    assert.isNotNull(sellerTokenInfo);
    assert.equal(sellerTokenInfo!.data.readBigUInt64LE(64), 1n);
    assert.equal(sellerTokenInfo!.data[108], 2);
  });

  it("allows only the event organizer to check in a listed ticket once", async () => {
    const fixture = await createResaleFixture(41);
    const otherEventId = new anchor.BN(42);
    const [otherEvent] = eventPda(fixture.organizer.publicKey, otherEventId);
    await program.methods
      .initializeEvent(otherEventId, 10, fixture.faceValue, 11_000, 500)
      .accounts({
        organizer: fixture.organizer.publicKey,
        event: otherEvent,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([fixture.organizer])
      .rpc();

    const otherOrganizer = anchor.web3.Keypair.generate();
    const otherOrganizerFunding = await provider.connection.requestAirdrop(
      otherOrganizer.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(otherOrganizerFunding, "confirmed");
    const otherOrganizerEventId = new anchor.BN(43);
    const [otherOrganizerEvent] = eventPda(otherOrganizer.publicKey, otherOrganizerEventId);
    await program.methods
      .initializeEvent(otherOrganizerEventId, 10, fixture.faceValue, 11_000, 500)
      .accounts({
        organizer: otherOrganizer.publicKey,
        event: otherOrganizerEvent,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([otherOrganizer])
      .rpc();

    const unrelatedSigner = anchor.web3.Keypair.generate();
    const unrelatedFunding = await provider.connection.requestAirdrop(
      unrelatedSigner.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(unrelatedFunding, "confirmed");

    const listingPrice = new anchor.BN(900_000_000);
    await program.methods
      .listTicket(listingPrice)
      .accounts({
        holder: fixture.seller.publicKey,
        event: fixture.event,
        ticket: fixture.ticket,
        tokenAccount: fixture.sellerTokenAccount,
      })
      .signers([fixture.seller])
      .rpc();

    const accounts = checkInAccounts(
      fixture.organizer.publicKey,
      fixture.event,
      fixture.ticket,
      fixture.mint.publicKey,
      fixture.seller.publicKey,
      fixture.sellerTokenAccount
    );
    for (const unauthorized of [fixture.seller, unrelatedSigner, otherOrganizer]) {
      await expectProgramError(
        program.methods
          .checkInTicket()
          .accounts({ ...accounts, organizer: unauthorized.publicKey })
          .signers([unauthorized])
          .rpc(),
        "NotEventOrganizer"
      );
    }

    await expectProgramError(
      program.methods
        .checkInTicket()
        .accounts({ ...accounts, event: otherEvent })
        .signers([fixture.organizer])
        .rpc(),
      "WrongEvent"
    );
    let ticketState = await program.account.ticket.fetch(fixture.ticket);
    assert.isFalse(ticketState.isUsed);
    assert.equal(ticketState.usedAt.toString(), "0");
    assert.isTrue(ticketState.listingPrice.eq(listingPrice));
    assert.equal(ticketState.resaleCount, 0);

    const tokenBefore = await provider.connection.getAccountInfo(fixture.sellerTokenAccount);
    assert.isNotNull(tokenBefore);
    assert.equal(tokenBefore!.data.readBigUInt64LE(64), 1n);
    assert.equal(tokenBefore!.data[108], 2, "listed ticket remains frozen");
    const clockBefore = await clockUnixTimestamp();
    await program.methods.checkInTicket().accounts(accounts).signers([fixture.organizer]).rpc();
    const clockAfter = await clockUnixTimestamp();

    ticketState = await program.account.ticket.fetch(fixture.ticket);
    assert.isTrue(ticketState.isUsed);
    const usedAt = BigInt(ticketState.usedAt.toString());
    assert.isTrue(usedAt > 0n);
    assert.isTrue(usedAt >= clockBefore - 2n, "timestamp must be current on-chain time");
    assert.isTrue(usedAt <= clockAfter + 2n, "timestamp must be current on-chain time");
    assert.isTrue(ticketState.listingPrice.eq(listingPrice), "check-in preserves the listing");
    assert.equal(ticketState.resaleCount, 0);
    const tokenAfter = await provider.connection.getAccountInfo(fixture.sellerTokenAccount);
    assert.isNotNull(tokenAfter);
    assert.deepEqual(tokenAfter!.data, tokenBefore!.data, "check-in must not change token state");

    await expectProgramError(
      program.methods.checkInTicket().accounts(accounts).signers([fixture.organizer]).rpc(),
      "TicketAlreadyUsed"
    );
    const ticketAfterDuplicate = await program.account.ticket.fetch(fixture.ticket);
    assert.isTrue(ticketAfterDuplicate.isUsed);
    assert.isTrue(ticketAfterDuplicate.usedAt.eq(ticketState.usedAt));
    assert.isTrue(ticketAfterDuplicate.listingPrice.eq(listingPrice));
    assert.equal(ticketAfterDuplicate.resaleCount, 0);
  });

  it("allows the organizer to check in the current owner after resale", async () => {
    const fixture = await createResaleFixture(44);
    const buyer = anchor.web3.Keypair.generate();
    const buyerFunding = await provider.connection.requestAirdrop(
      buyer.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(buyerFunding, "confirmed");
    const buyerTokenAccount = associatedTokenAddress(buyer.publicKey, fixture.mint.publicKey);
    await program.methods
      .listTicket(fixture.faceValue)
      .accounts({
        holder: fixture.seller.publicKey,
        event: fixture.event,
        ticket: fixture.ticket,
        tokenAccount: fixture.sellerTokenAccount,
      })
      .signers([fixture.seller])
      .rpc();
    await program.methods
      .resellTicket()
      .accounts({
        buyer: buyer.publicKey,
        event: fixture.event,
        ticket: fixture.ticket,
        organizer: fixture.organizer.publicKey,
        seller: fixture.seller.publicKey,
        platformConfig: platformConfigPda(),
        platformWallet,
        ticketAuthority: ticketAuthorityPda(),
        mint: fixture.mint.publicKey,
        sellerTokenAccount: fixture.sellerTokenAccount,
        buyerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    const tokenBefore = await provider.connection.getAccountInfo(buyerTokenAccount);
    assert.isNotNull(tokenBefore);
    assert.equal(tokenBefore!.data.readBigUInt64LE(64), 1n);
    assert.equal(tokenBefore!.data[108], 2);
    const ticketBefore = await program.account.ticket.fetch(fixture.ticket);
    assert.isFalse(ticketBefore.isUsed);
    assert.isNull(ticketBefore.listingPrice);
    assert.equal(ticketBefore.resaleCount, 1);

    await program.methods
      .checkInTicket()
      .accounts(
        checkInAccounts(
          fixture.organizer.publicKey,
          fixture.event,
          fixture.ticket,
          fixture.mint.publicKey,
          buyer.publicKey,
          buyerTokenAccount
        )
      )
      .signers([fixture.organizer])
      .rpc();

    const ticketAfter = await program.account.ticket.fetch(fixture.ticket);
    assert.isTrue(ticketAfter.isUsed);
    assert.isTrue(ticketAfter.usedAt.gt(new anchor.BN(0)));
    assert.isNull(ticketAfter.listingPrice);
    assert.equal(ticketAfter.resaleCount, 1);
    const tokenAfter = await provider.connection.getAccountInfo(buyerTokenAccount);
    assert.isNotNull(tokenAfter);
    assert.deepEqual(tokenAfter!.data, tokenBefore!.data, "check-in must not move or thaw the ticket");
  });

  it("rejects a mint beyond event capacity without changing state or payments", async () => {
    const organizer = anchor.web3.Keypair.generate();
    const buyer = anchor.web3.Keypair.generate();
    const eventId = new anchor.BN(22);
    const basePrice = new anchor.BN(1_000_000);
    const [event] = eventPda(organizer.publicKey, eventId);
    for (const keypair of [organizer, buyer]) {
      const signature = await provider.connection.requestAirdrop(
        keypair.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature, "confirmed");
    }
    const platformFunding = await provider.connection.requestAirdrop(
      platformWallet,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(platformFunding, "confirmed");
    await program.methods
      .initializeEvent(eventId, 1, basePrice, 11_000, 500)
      .accounts({
        organizer: organizer.publicKey,
        event,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([organizer])
      .rpc();

    const firstMint = anchor.web3.Keypair.generate();
    const [firstTicket] = ticketPda(firstMint.publicKey);
    await program.methods
      .mintTicket("Sold Out Test", "https://example.test/sold-out.json")
      .accounts({
        buyer: buyer.publicKey,
        event,
        organizer: organizer.publicKey,
        platformConfig: platformConfigPda(),
        platformWallet,
        ticketAuthority: ticketAuthorityPda(),
        mint: firstMint.publicKey,
        ticket: firstTicket,
        buyerTokenAccount: associatedTokenAddress(buyer.publicKey, firstMint.publicKey),
        metadata: metadataPda(firstMint.publicKey),
        tokenMetadataProgram: METAPLEX_TOKEN_METADATA_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([buyer, firstMint])
      .rpc();

    const soldOutMint = anchor.web3.Keypair.generate();
    const [soldOutTicket] = ticketPda(soldOutMint.publicKey);
    const organizerBefore = await provider.connection.getBalance(organizer.publicKey);
    const platformBefore = await provider.connection.getBalance(platformWallet);
    await expectProgramError(
      program.methods
        .mintTicket("Sold Out Test", "https://example.test/sold-out.json")
        .accounts({
          buyer: buyer.publicKey,
          event,
          organizer: organizer.publicKey,
          platformConfig: platformConfigPda(),
          platformWallet,
          ticketAuthority: ticketAuthorityPda(),
          mint: soldOutMint.publicKey,
          ticket: soldOutTicket,
          buyerTokenAccount: associatedTokenAddress(buyer.publicKey, soldOutMint.publicKey),
          metadata: metadataPda(soldOutMint.publicKey),
          tokenMetadataProgram: METAPLEX_TOKEN_METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([buyer, soldOutMint])
        .rpc(),
      "SoldOut"
    );
    assert.equal((await program.account.event.fetch(event)).ticketsSold, 1);
    assert.isNull(await provider.connection.getAccountInfo(soldOutTicket));
    assert.equal(await provider.connection.getBalance(organizer.publicKey), organizerBefore);
    assert.equal(await provider.connection.getBalance(platformWallet), platformBefore);
  });

  it("rejects organizer and platform payment destinations that do not match state", async () => {
    const organizer = anchor.web3.Keypair.generate();
    const buyer = anchor.web3.Keypair.generate();
    const wrongDestination = anchor.web3.Keypair.generate();
    const eventId = new anchor.BN(23);
    const [event] = eventPda(organizer.publicKey, eventId);
    for (const keypair of [organizer, buyer, wrongDestination]) {
      const signature = await provider.connection.requestAirdrop(
        keypair.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature, "confirmed");
    }
    await program.methods
      .initializeEvent(eventId, 2, new anchor.BN(1_000_000), 11_000, 500)
      .accounts({
        organizer: organizer.publicKey,
        event,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([organizer])
      .rpc();

    for (const invalidAccount of ["organizer", "platformWallet"] as const) {
      const mint = anchor.web3.Keypair.generate();
      const [ticket] = ticketPda(mint.publicKey);
      const accounts = {
        buyer: buyer.publicKey,
        event,
        organizer: organizer.publicKey,
        platformConfig: platformConfigPda(),
        platformWallet,
        ticketAuthority: ticketAuthorityPda(),
        mint: mint.publicKey,
        ticket,
        buyerTokenAccount: associatedTokenAddress(buyer.publicKey, mint.publicKey),
        metadata: metadataPda(mint.publicKey),
        tokenMetadataProgram: METAPLEX_TOKEN_METADATA_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      };
      if (invalidAccount === "organizer") accounts.organizer = wrongDestination.publicKey;
      else accounts.platformWallet = wrongDestination.publicKey;
      await expectProgramError(
        program.methods
          .mintTicket("Wrong Destination Test", "https://example.test/invalid.json")
          .accounts(accounts)
          .signers([buyer, mint])
          .rpc(),
        invalidAccount === "organizer" ? "InvalidOrganizer" : "ConstraintAddress"
      );
      assert.equal((await program.account.event.fetch(event)).ticketsSold, 0);
      assert.isNull(await provider.connection.getAccountInfo(ticket));
    }
  });
});
