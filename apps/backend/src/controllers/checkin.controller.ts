import type { Request, Response, NextFunction } from "express";
import { Ticket } from "../models/Ticket.model";

export async function verifyTicket(req: Request, res: Response, next: NextFunction) {
  try {
    const { mintAddress } = req.body;
    const ticket = await Ticket.findOne({ mintAddress });

    if (!ticket) return res.status(404).json({ valid: false, reason: "Ticket not found" });
    if (ticket.isCheckedIn) return res.status(409).json({ valid: false, reason: "Already checked in" });

    // TODO: also re-verify current owner + checked-in flag directly on-chain
    // (don't trust the Mongo cache alone for the actual gate decision)
    res.json({ valid: true, ticket });
  } catch (err) {
    next(err);
  }
}
