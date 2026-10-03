import type { NextFunction, Request, Response } from "express";
import {
  buildInitializeEventTransaction as buildInitializeEventTx,
  buildMintTicketTransaction as buildMintTicketTx,
  TransactionInputError,
} from "../services/solanaTx.service";

type RequestBody = Record<string, unknown>;

function requestBody(value: unknown): RequestBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TransactionInputError("Request body must be a JSON object");
  }
  return value as RequestBody;
}

function stringField(body: RequestBody, field: string): string {
  const value = body[field];
  if (typeof value !== "string") throw new TransactionInputError(`${field} must be a string`);
  return value;
}

function numberField(body: RequestBody, field: string): number {
  const value = body[field];
  if (typeof value !== "number") throw new TransactionInputError(`${field} must be a number`);
  return value;
}

export async function buildInitializeEventTransaction(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = requestBody(req.body);
    const result = await buildInitializeEventTx({
      organizerPubkey: stringField(body, "organizerPubkey"),
      eventId: stringField(body, "eventId"),
      maxTickets: numberField(body, "maxTickets"),
      basePriceLamports: stringField(body, "basePriceLamports"),
      resaleCapBps: numberField(body, "resaleCapBps"),
      royaltyBps: numberField(body, "royaltyBps"),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function buildMintTicketTransaction(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = requestBody(req.body);
    const result = await buildMintTicketTx({
      buyerPubkey: stringField(body, "buyerPubkey"),
      eventPda: stringField(body, "eventPda"),
      mintPubkey: stringField(body, "mintPubkey"),
      eventName: stringField(body, "eventName"),
      uri: stringField(body, "uri"),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
