import { Router } from "express";
import { verifyTicket, buildCheckInTransaction } from "../controllers/checkin.controller";

const router = Router();

// Step 1: scanner app hits this right after reading the QR code
router.post("/verify", verifyTicket);              // POST /api/checkin/verify

// Step 2: if valid, request the unsigned check_in_ticket tx
// (signed by the organizer/gate wallet, not the ticket holder)
router.post("/", buildCheckInTransaction);         // POST /api/checkin

export default router;