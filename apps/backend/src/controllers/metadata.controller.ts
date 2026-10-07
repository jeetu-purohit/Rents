import type { Request, Response, NextFunction } from "express";
import { getTicketMetadata } from "../services/metadata.service";

export async function getTicketMetadataController(req: Request, res: Response, next: NextFunction) {
  try {
    const mint = typeof req.params.mint === "string" ? req.params.mint : "";
    res.json(await getTicketMetadata(mint));
  } catch (err) {
    next(err);
  }
}
