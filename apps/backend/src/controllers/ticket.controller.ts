import type { Request, Response, NextFunction } from "express";
import { Ticket } from "../models/Ticket.model";
import { syncTicket } from "../services/indexer.service";
import { ApiError } from "../middleware/requestValidation";

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
    const tickets = await Ticket.find({ eventPda: req.params.eventId });
    res.json(tickets);
  } catch (err) {
    next(err);
  }
}

export async function getTicketByMint(req: Request, res: Response, next: NextFunction) {
  try {
    const ticket = await Ticket.findOne({ mintAddress: req.params.mint });
    if (!ticket) throw new ApiError("Ticket not found", 404, "NOT_FOUND");
    res.json(ticket);
  } catch (err) {
    next(err);
  }
}

export async function getActiveListings(_req: Request, res: Response, next: NextFunction) {
  try {
    const tickets = await Ticket.find({
      listingPriceLamports: { $exists: true, $ne: null },
    }).sort({ lastSyncedAt: -1 });
    res.json(tickets);
  } catch (err) {
    next(err);
  }
}

export async function syncTicketByMint(req: Request, res: Response, next: NextFunction) {
  try {
    const ticket = await syncTicket(typeof req.params.mint === "string" ? req.params.mint : "");
    res.json(ticket);
  } catch (err) {
    next(err);
  }
}
