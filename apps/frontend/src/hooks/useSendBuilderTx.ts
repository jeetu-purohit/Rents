import { useCallback, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type {
  CancelListingTransactionRequest,
  CheckInTicketTransactionRequest,
  InitializeEventTransactionDto,
  MintTicketTransactionDto,
  UnsignedTransactionDto,
  EventDto,
} from "shared";
import { ApiError, api } from "../lib/api";
import { frontendConfig } from "../lib/config";

export type BuilderTxAction =
  | {
      kind: "initialize-event";
      input: Omit<import("shared").InitializeEventTransactionRequest, "organizerPubkey">;
    }
  | {
      kind: "mint";
      input: Pick<import("shared").MintTicketTransactionRequest, "eventPda" | "eventName">;
    }
  | { kind: "list"; input: Omit<import("shared").ListTicketTransactionRequest, "holderPubkey"> }
  | { kind: "cancel-listing"; input: Omit<CancelListingTransactionRequest, "holderPubkey"> }
  | { kind: "resell"; input: Omit<import("shared").ResellTicketTransactionRequest, "buyerPubkey"> }
  | { kind: "check-in"; input: Omit<CheckInTicketTransactionRequest, "organizerPubkey"> };

export type BuilderTxStatus =
  | "idle"
  | "preparing"
  | "ready"
  | "signing"
  | "sending"
  | "confirming"
  | "syncing"
  | "success"
  | "error";

export interface BuilderTxReview {
  kind: BuilderTxAction["kind"];
  label: string;
  network: "devnet";
  feePayer: string;
  programId: string;
  mintPubkey?: string;
  eventPda?: string;
  blockhash: string;
  lastValidBlockHeight: number;
  networkFeeLamports: number;
  simulationUnits?: number;
  simulationLogs: string[];
  ticketFaceLamports?: string;
  platformFeeLamports?: string;
  platformWallet?: string;
  eventRentLamports?: number;
}

export interface BuilderTxResult {
  signature: string;
  mintPubkey?: string;
  ticketPda?: string;
  eventPda?: string;
  syncError?: string;
}

export interface BuilderTxState {
  status: BuilderTxStatus;
  message: string;
  errorCode?: string;
  signature?: string;
  review?: BuilderTxReview;
  result?: BuilderTxResult;
}

interface PreparedTx {
  action: BuilderTxAction;
  transaction: Transaction;
  response: UnsignedTransactionDto;
  mintSigner?: Keypair;
  mintPubkey?: string;
  eventPda?: string;
  ticketPda?: string;
  review: BuilderTxReview;
}

const PROGRAM_ERRORS: Record<number, { name: string; message: string }> = {
  6000: {
    name: "PriceExceedsCap",
    message: "The resale price is above this ticket’s on-chain cap.",
  },
  6001: { name: "AlreadyCheckedIn", message: "This ticket has already been checked in." },
  6002: { name: "SoldOut", message: "This event has sold out." },
  6003: { name: "InvalidOrganizer", message: "The organizer does not match this event." },
  6004: { name: "MathOverFlow", message: "The on-chain fee calculation overflowed." },
  6005: { name: "Unauthorized", message: "This wallet is not authorized for this action." },
  6006: { name: "NotAdmin", message: "Only the platform administrator can perform this action." },
  6007: { name: "InvalidFee", message: "The platform fee is outside the allowed range." },
  6008: { name: "NotTicketOwner", message: "The seller does not own this ticket." },
  6009: { name: "InvalidBps", message: "The event percentage settings are invalid." },
  6010: { name: "InvalidPrice", message: "Enter a price greater than zero." },
  6011: { name: "NotListed", message: "This ticket is not listed for resale." },
  6012: { name: "TicketAlreadyUsed", message: "This ticket has already been checked in." },
  6013: { name: "NotTicketHolder", message: "This wallet does not hold the ticket." },
  6014: { name: "NotEventOrganizer", message: "Only the event organizer can perform this action." },
  6015: { name: "SelfPurchase", message: "You cannot buy your own ticket." },
  6016: { name: "MathOverflow", message: "The on-chain amount calculation overflowed." },
  6017: { name: "WrongEvent", message: "This ticket belongs to a different event." },
  6018: { name: "InvalidMaxTickets", message: "The event must allow at least one ticket." },
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown transaction error";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function customProgramCode(value: unknown, logs: string[]): number | undefined {
  const text = `${errorText(value)}\n${logs.join("\n")}`;
  const named = text.match(/Error Code:\s*([A-Za-z0-9_]+)/)?.[1];
  const namedCode = Object.entries(PROGRAM_ERRORS).find(([, entry]) => entry.name === named)?.[0];
  if (namedCode) return Number(namedCode);
  const decimal = text.match(/(?:Error Number:|Custom:\s*)(\d{4,5})/i)?.[1];
  if (decimal) return Number(decimal);
  const hex = text.match(/custom program error:\s*0x([0-9a-f]+)/i)?.[1];
  return hex ? Number.parseInt(hex, 16) : undefined;
}

async function explainError(
  error: unknown,
  connection: ReturnType<typeof useConnection>["connection"],
): Promise<{ message: string; code: string }> {
  let logs: string[] = [];
  if (error instanceof SendTransactionError) {
    try {
      logs = await error.getLogs(connection);
    } catch {
      logs = error.logs ?? [];
    }
  } else if (isRecord(error) && Array.isArray(error.logs)) {
    logs = error.logs.filter((line): line is string => typeof line === "string");
  }

  if (error instanceof ApiError) return { message: error.message, code: error.code };
  const walletError = errorText(error);
  if (
    /user rejected|rejected the request|request was rejected|cancelled|canceled/i.test(
      walletError,
    ) ||
    (isRecord(error) && error.code === 4001)
  ) {
    return {
      message: `Wallet signing was cancelled. No transaction was sent. ${walletError}`,
      code: "WALLET_REJECTED",
    };
  }

  const programCode = customProgramCode(error, logs);
  const known = programCode === undefined ? undefined : PROGRAM_ERRORS[programCode];
  if (known && programCode !== undefined) {
    return {
      message: `${known.message} (program error ${known.name}, ${programCode}). ${walletError}`,
      code: known.name,
    };
  }
  const detail = logs.length ? `\n${logs.slice(-8).join("\n")}` : "";
  return { message: `${walletError}${detail}`, code: "TRANSACTION_FAILED" };
}

function decodeBase64(value: string): Uint8Array {
  if (
    !value ||
    value.length > 100_000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error("The transaction builder returned malformed base64 transaction data.");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validateTransaction(
  transaction: Transaction,
  response: UnsignedTransactionDto,
  walletKey: PublicKey,
  mintSigner?: Keypair,
): void {
  if (
    !Number.isSafeInteger(response.lastValidBlockHeight) ||
    response.lastValidBlockHeight < 0 ||
    !response.blockhash
  ) {
    throw new Error("The transaction builder returned invalid blockhash validity data.");
  }
  if (transaction.recentBlockhash !== response.blockhash)
    throw new Error("The transaction blockhash does not match the builder response.");
  if (!transaction.feePayer?.equals(walletKey))
    throw new Error("The transaction fee payer is not the connected wallet.");
  if (
    !transaction.instructions.some((instruction) =>
      instruction.programId.equals(frontendConfig.programId),
    )
  ) {
    throw new Error("The transaction does not call the configured RENTS program.");
  }

  const message = transaction.compileMessage();
  const requiredSigners = message.accountKeys
    .slice(0, message.header.numRequiredSignatures)
    .map((key) => key.toBase58())
    .sort();
  const expectedSigners = [
    walletKey.toBase58(),
    ...(mintSigner ? [mintSigner.publicKey.toBase58()] : []),
  ].sort();
  if (
    requiredSigners.length !== expectedSigners.length ||
    requiredSigners.some((key, index) => key !== expectedSigners[index])
  ) {
    throw new Error("The transaction has an unexpected signer set; it was not sent.");
  }
}

function createBuildRequest(action: BuilderTxAction, walletKey: PublicKey, mintSigner?: Keypair) {
  switch (action.kind) {
    case "initialize-event":
      return api.buildInitializeEvent({ ...action.input, organizerPubkey: walletKey.toBase58() });
    case "mint": {
      if (!mintSigner) throw new Error("The client mint signer is missing.");
      const mintPubkey = mintSigner.publicKey.toBase58();
      const uri = `${frontendConfig.apiBaseUrl}/metadata/${encodeURIComponent(mintPubkey)}`;
      return api.buildMintTicket({
        ...action.input,
        buyerPubkey: walletKey.toBase58(),
        mintPubkey,
        uri,
      });
    }
    case "list":
      return api.buildListTicket({ ...action.input, holderPubkey: walletKey.toBase58() });
    case "cancel-listing":
      return api.buildCancelListing({ ...action.input, holderPubkey: walletKey.toBase58() });
    case "resell":
      return api.buildResellTicket({ ...action.input, buyerPubkey: walletKey.toBase58() });
    case "check-in":
      return api.buildCheckInTicket({ ...action.input, organizerPubkey: walletKey.toBase58() });
  }
}

function actionLabel(action: BuilderTxAction): string {
  switch (action.kind) {
    case "initialize-event":
      return "Initialize event";
    case "mint":
      return "Mint ticket";
    case "list":
      return "List ticket for resale";
    case "cancel-listing":
      return "Cancel resale listing";
    case "resell":
      return "Buy resale ticket";
    case "check-in":
      return "Check in ticket";
  }
}

function responseExtras(
  action: BuilderTxAction,
  response: UnsignedTransactionDto,
): Pick<PreparedTx, "mintPubkey" | "eventPda" | "ticketPda"> {
  if (action.kind === "initialize-event") {
    const value = response as InitializeEventTransactionDto;
    if (!isRecord(value) || typeof value.eventPda !== "string")
      throw new Error("The builder response is missing its event PDA.");
    return { eventPda: new PublicKey(value.eventPda).toBase58() };
  }
  if (action.kind === "mint") {
    const value = response as MintTicketTransactionDto;
    if (!isRecord(value) || typeof value.ticketPda !== "string")
      throw new Error("The builder response is missing its ticket PDA.");
    return {
      mintPubkey: "",
      ticketPda: new PublicKey(value.ticketPda).toBase58(),
      eventPda: action.input.eventPda,
    };
  }
  if ("mintPubkey" in action.input) return { mintPubkey: action.input.mintPubkey };
  return {};
}

export function useSendBuilderTx() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [state, setState] = useState<BuilderTxState>({ status: "idle", message: "" });
  const pending = useRef<PreparedTx | null>(null);

  const prepare = useCallback(
    async (action: BuilderTxAction) => {
      if (!publicKey) {
        const message = "Connect your Phantom wallet before preparing a transaction.";
        setState({ status: "error", message, errorCode: "WALLET_NOT_CONNECTED" });
        throw new Error(message);
      }
      pending.current = null;
      setState({ status: "preparing", message: "Building and simulating transaction…" });
      try {
        const mintSigner = action.kind === "mint" ? Keypair.generate() : undefined;
        if (mintSigner && (await connection.getAccountInfo(mintSigner.publicKey, "confirmed"))) {
          throw new Error(
            "The newly generated mint public key already exists on Devnet. Prepare again to generate a different mint key.",
          );
        }
        const response = await createBuildRequest(action, publicKey, mintSigner);
        if (
          !isRecord(response) ||
          typeof response.transaction !== "string" ||
          typeof response.blockhash !== "string" ||
          typeof response.lastValidBlockHeight !== "number"
        ) {
          throw new Error("The transaction builder returned an incomplete response.");
        }
        const transaction = Transaction.from(decodeBase64(response.transaction));
        validateTransaction(transaction, response as UnsignedTransactionDto, publicKey, mintSigner);
        let mintReview: Pick<
          BuilderTxReview,
          "ticketFaceLamports" | "platformFeeLamports" | "platformWallet"
        > = {};
        let eventRentLamports: number | undefined;
        if (action.kind === "mint") {
          const [events, platform] = await Promise.all([api.getEvents(), api.getPlatform()]);
          const event: EventDto | undefined = events.find(
            (candidate) => candidate.eventPda === action.input.eventPda,
          );
          if (!event)
            throw new Error(
              "Mongo Event metadata is missing for this on-chain Event; mint metadata would not resolve.",
            );
          const face = BigInt(event.basePriceLamports);
          const fee = (face * BigInt(platform.platformFeeBps)) / 10_000n;
          mintReview = {
            ticketFaceLamports: face.toString(),
            platformFeeLamports: fee.toString(),
            platformWallet: platform.platformWallet,
          };
        } else if (action.kind === "initialize-event") {
          eventRentLamports = await connection.getMinimumBalanceForRentExemption(69, "confirmed");
        }
        const feeResponse = await connection.getFeeForMessage(
          transaction.compileMessage(),
          "confirmed",
        );
        if (feeResponse.value === null)
          throw new Error("Devnet could not estimate this transaction’s network fee.");
        const simulation = await connection.simulateTransaction(
          new VersionedTransaction(transaction.compileMessage()),
          { sigVerify: false, commitment: "confirmed" },
        );
        if (simulation.value.err) {
          const simulationError = Object.assign(new Error(JSON.stringify(simulation.value.err)), {
            logs: simulation.value.logs ?? [],
          });
          throw simulationError;
        }
        const extras = responseExtras(action, response as UnsignedTransactionDto);
        const prepared: PreparedTx = {
          action,
          transaction,
          response: response as UnsignedTransactionDto,
          mintSigner,
          ...extras,
          review: {
            kind: action.kind,
            label: actionLabel(action),
            network: frontendConfig.network,
            feePayer: publicKey.toBase58(),
            programId: frontendConfig.programId.toBase58(),
            ...(mintSigner ? { mintPubkey: mintSigner.publicKey.toBase58() } : {}),
            ...(extras.eventPda ? { eventPda: extras.eventPda } : {}),
            blockhash: response.blockhash,
            lastValidBlockHeight: response.lastValidBlockHeight,
            networkFeeLamports: feeResponse.value,
            ...(simulation.value.unitsConsumed !== undefined
              ? { simulationUnits: simulation.value.unitsConsumed }
              : {}),
            simulationLogs: (simulation.value.logs ?? []).slice(-8),
            ...mintReview,
            ...(eventRentLamports !== undefined ? { eventRentLamports } : {}),
          },
        };
        if (action.kind === "mint") prepared.mintPubkey = mintSigner?.publicKey.toBase58();
        pending.current = prepared;
        setState({
          status: "ready",
          message: "Simulation passed. Review the transaction before signing.",
          review: prepared.review,
        });
        return prepared.review;
      } catch (error) {
        const explained = await explainError(error, connection);
        setState({ status: "error", message: explained.message, errorCode: explained.code });
        throw new Error(explained.message);
      }
    },
    [connection, publicKey],
  );

  const send = useCallback(async () => {
    const prepared = pending.current;
    if (!prepared) throw new Error("Prepare and review a transaction before signing.");
    if (!publicKey || !publicKey.equals(prepared.transaction.feePayer ?? PublicKey.default)) {
      setState({
        status: "error",
        message: "The connected wallet changed. Prepare the transaction again.",
        errorCode: "WALLET_CHANGED",
      });
      throw new Error("The connected wallet changed. Prepare the transaction again.");
    }
    if (!signTransaction) {
      setState({
        status: "error",
        message: "The connected wallet cannot sign transactions.",
        errorCode: "WALLET_SIGN_UNAVAILABLE",
      });
      throw new Error("The connected wallet cannot sign transactions.");
    }

    let signature: string | undefined;
    try {
      setState({
        status: "signing",
        message: "Approve the transaction in Phantom.",
        review: prepared.review,
      });
      if (prepared.mintSigner) prepared.transaction.partialSign(prepared.mintSigner);
      const signed = await signTransaction(prepared.transaction);
      const rawTransaction = signed.serialize({
        requireAllSignatures: true,
        verifySignatures: true,
      });
      setState({
        status: "sending",
        message: "Sending signed transaction to Devnet…",
        review: prepared.review,
      });
      signature = await connection.sendRawTransaction(rawTransaction, {
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
      setState({
        status: "confirming",
        message: "Waiting for Devnet confirmation…",
        review: prepared.review,
        signature,
      });
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: prepared.response.blockhash,
          lastValidBlockHeight: prepared.response.lastValidBlockHeight,
        },
        "confirmed",
      );
      if (confirmation.value.err) {
        const transaction = await connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        const confirmError = Object.assign(new Error(JSON.stringify(confirmation.value.err)), {
          logs: transaction?.meta?.logMessages ?? [],
        });
        throw confirmError;
      }

      const result: BuilderTxResult = {
        signature,
        ...(prepared.mintPubkey ? { mintPubkey: prepared.mintPubkey } : {}),
        ...(prepared.ticketPda ? { ticketPda: prepared.ticketPda } : {}),
        ...(prepared.eventPda ? { eventPda: prepared.eventPda } : {}),
      };
      const ticketMint =
        prepared.action.kind === "mint"
          ? prepared.mintPubkey
          : "mintPubkey" in prepared.action.input
            ? prepared.action.input.mintPubkey
            : undefined;
      if (ticketMint) {
        const mint = new PublicKey(ticketMint);
        const [derivedTicketPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("ticket"), mint.toBuffer()],
          frontendConfig.programId,
        );
        if (prepared.ticketPda && !derivedTicketPda.equals(new PublicKey(prepared.ticketPda))) {
          throw new Error("The builder ticket PDA does not match the canonical mint-derived PDA.");
        }
        result.ticketPda = derivedTicketPda.toBase58();
        const ticketAccount = await connection.getAccountInfo(derivedTicketPda, "confirmed");
        if (!ticketAccount || !ticketAccount.owner.equals(frontendConfig.programId)) {
          throw new Error(
            "The confirmed transaction did not create the expected RENTS Ticket account.",
          );
        }
        setState({
          status: "syncing",
          message: "Transaction confirmed. Syncing ticket cache…",
          review: prepared.review,
          signature,
        });
        try {
          const ticket = await api.syncTicket(ticketMint);
          if (ticket.mintAddress !== ticketMint || ticket.ticketPda !== result.ticketPda)
            throw new Error("The sync endpoint returned a different ticket mint or PDA.");
          if (prepared.action.kind === "mint") {
            if (
              ticket.eventPda !== prepared.eventPda ||
              ticket.ownerPubkey !== publicKey?.toBase58() ||
              ticket.faceValueLamports !== prepared.review.ticketFaceLamports
            ) {
              throw new Error(
                "The synced ticket state does not match the confirmed mint transaction.",
              );
            }
            const metadata = await api.getMetadata(ticketMint);
            if (
              metadata.symbol !== "RENTS" ||
              !metadata.name.startsWith(`${prepared.action.input.eventName} #`)
            ) {
              throw new Error(
                "The ticket metadata endpoint did not return the expected RENTS metadata.",
              );
            }
          }
        } catch (syncError) {
          const explained = await explainError(syncError, connection);
          result.syncError = explained.message;
        }
      }

      pending.current = null;
      setState({
        status: "success",
        message: result.syncError
          ? "On-chain transaction confirmed on Devnet; ticket cache sync failed."
          : "Transaction confirmed on Devnet and ticket sync completed.",
        review: prepared.review,
        signature,
        result,
      });
      return result;
    } catch (error) {
      const explained = await explainError(error, connection);
      setState({
        status: "error",
        message: signature ? `${explained.message} (signature: ${signature})` : explained.message,
        errorCode: explained.code,
        review: prepared.review,
        ...(signature ? { signature } : {}),
      });
      throw new Error(explained.message);
    }
  }, [connection, publicKey, signTransaction]);

  const reset = useCallback(() => {
    pending.current = null;
    setState({ status: "idle", message: "" });
  }, []);

  return {
    state,
    prepare,
    send,
    reset,
    busy: ["preparing", "signing", "sending", "confirming", "syncing"].includes(state.status),
  };
}
