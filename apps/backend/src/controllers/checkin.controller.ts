import type { Request, Response, NextFunction } from "express";
import { CheckInVerificationError, verifyCheckIn } from "../services/checkinVerification.service";

export async function verifyTicket(req: Request, res: Response, next: NextFunction) {
  try {
    const body: unknown = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new CheckInVerificationError("Request body must be a JSON object", 400);
    }
    const fields = body as Record<string, unknown>;
    const mint = typeof fields.mint === "string" ? fields.mint : fields.mintAddress;
    if (typeof mint !== "string") throw new CheckInVerificationError("mint must be a string", 400);
    if (typeof fields.owner !== "string") throw new CheckInVerificationError("owner must be a string", 400);
    if (typeof fields.eventPda !== "string") throw new CheckInVerificationError("eventPda must be a string", 400);

    res.json(await verifyCheckIn({
      mint,
      owner: fields.owner,
      eventPda: fields.eventPda,
    }));
  } catch (err) {
    if (err instanceof CheckInVerificationError) {
      res.status(err.status).json({ valid: false, reason: err.message });
      return;
    }
    next(err);
  }
}
