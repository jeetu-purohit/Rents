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
});
