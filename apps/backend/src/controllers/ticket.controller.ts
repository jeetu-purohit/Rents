import type { Request, Response, NextFunction } from "express";
import { Ticket } from "../models/Ticket.model";

export async function getTicketsByOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const tickets = await Ticket.find({ ownerPubkey: req.params.pubkey });
    res.json(tickets);
  } catch (err) {
    next(err);
  }
}

export async function getTicketsByEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const tickets = await Ticket.find({ eventOnChainId: req.params.eventId });
    res.json(tickets);
  } catch (err) {
    next(err);
  }
}

export async function getTicketByMint(req: Request, res: Response, next: NextFunction) {
  try {
    const ticket = await Ticket.findOne({ mintAddress: req.params.mint });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    res.json(ticket);
  } catch (err) {
    next(err);
  }
}

export async function buildMintTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    // TODO (solanaTx.service.ts): build the mint_ticket instruction using
    // Anchor program + Metaplex CPI accounts, return a base64 unsigned tx
    // for the frontend to sign with Phantom and submit.
    res.status(501).json({ message: "buildMintTransaction not implemented yet" });
  } catch (err) {
    next(err);
  }
}

export async function buildResellTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    // TODO (solanaTx.service.ts): build the resell_ticket instruction,
    // enforcing price cap client-side too (chain is the real enforcer),
    // return a base64 unsigned tx.
    res.status(501).json({ message: "buildResellTransaction not implemented yet" });
  } catch (err) {
    next(err);
  }
}