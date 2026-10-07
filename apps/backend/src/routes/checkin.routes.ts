import { Router } from "express";
import { verifyTicket } from "../controllers/checkin.controller";
import type { RequestHandler } from "express";
import { publicKeyString, requestObject, RequestValidationError } from "../middleware/requestValidation";

const router = Router();

// Step 1: scanner app hits this right after reading the QR code
const validateCheckInBody: RequestHandler = (req, _res, next) => {
  try {
    const body = requestObject(req.body, "Request body");
    const unknownField = Object.keys(body).find((field) => !["mint", "mintAddress", "owner", "eventPda"].includes(field));
    if (unknownField) throw new RequestValidationError(`${unknownField} is not a supported request body field`);
    const mint = body.mint ?? body.mintAddress;
    publicKeyString(mint, "mint");
    publicKeyString(body.owner, "owner");
    publicKeyString(body.eventPda, "eventPda");
    next();
  } catch (error) {
    next(error);
  }
};
router.post("/verify", validateCheckInBody, verifyTicket);              // POST /api/checkin/verify

export default router;
