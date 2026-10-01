import { Router } from "express";
import {
  buildMintTransaction,
  buildResellTransaction,
  getTicketsByOwner,
  getTicketsByEvent,
  getTicketByMint,
} from "../controllers/ticket.controller";

const router = Router();

// Read (served from Mongo cache, synced by indexer)
router.get("/owner/:pubkey", getTicketsByOwner);   // GET /api/tickets/owner/:pubkey
router.get("/event/:eventId", getTicketsByEvent);  // GET /api/tickets/event/:eventId
router.get("/:mint", getTicketByMint);             // GET /api/tickets/:mint

// Write (returns an UNSIGNED tx for the frontend to sign via Phantom)
router.post("/mint", buildMintTransaction);        // POST /api/tickets/mint
router.post("/resell", buildResellTransaction);    // POST /api/tickets/resell

export default router;