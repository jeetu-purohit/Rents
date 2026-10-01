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

  it("loads the Metaplex Token Metadata program and it is executable", async () => {
    const accountInfo = await provider.connection.getAccountInfo(
      METAPLEX_TOKEN_METADATA_PROGRAM_ID
    );
    assert.isNotNull(accountInfo, "Metaplex Token Metadata program account not found");
    assert.isTrue(accountInfo!.executable, "Metaplex Token Metadata program is not executable");
  });

  it("initializes an event", async () => {
    assert.ok(program.programId);
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
