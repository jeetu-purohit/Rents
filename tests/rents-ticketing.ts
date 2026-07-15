import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

describe("rents-ticketing", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Adjust "RentsTicketing" to match the name in target/idl/*.json ("name" field)
  const program = anchor.workspace.RentsTicketing as Program;

  it("initializes an event", async () => {
    // placeholder — real test once initialize_event exists
    assert.ok(program.programId);
  });
});
