import { Router } from "express";
import { verifyTicket } from "../controllers/checkin.controller";

const router = Router();

// Step 1: scanner app hits this right after reading the QR code
router.post("/verify", verifyTicket);              // POST /api/checkin/verify

export default router;
