import type { Request, Response, NextFunction } from "express";
import { getPlatformConfig } from "../services/platform.service.js";

export async function getPlatformConfigController(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getPlatformConfig());
  } catch (err) {
    next(err);
  }
}
