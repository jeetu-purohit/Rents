import type { Request, Response, NextFunction } from "express";
import { verifyCheckIn } from "../services/checkinVerification.service";

export async function verifyTicket(req: Request, res: Response, next: NextFunction) {
  try {
    const body: unknown = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("Request body must be a JSON object");
    const fields = body as Record<string, unknown>;
    const mint = typeof fields.mint === "string" ? fields.mint : fields.mintAddress;
    if (typeof mint !== "string" || typeof fields.owner !== "string" || typeof fields.eventPda !== "string") {
      throw new Error("mint, owner, and eventPda must be strings");
    }

    res.json(await verifyCheckIn({
      mint,
      owner: fields.owner,
      eventPda: fields.eventPda,
    }));
  } catch (err) {
    next(err);
  }
}
