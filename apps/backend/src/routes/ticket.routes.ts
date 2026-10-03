import { Router } from "express";
import {
  getTicketsByOwner,
  getTicketsByEvent,
  getTicketByMint,
} from "../controllers/ticket.controller";

const router = Router();

// Read (served from Mongo cache, synced by indexer)
router.get("/owner/:pubkey", getTicketsByOwner);   // GET /api/tickets/owner/:pubkey
router.get("/event/:eventId", getTicketsByEvent);  // GET /api/tickets/event/:eventId
router.get("/:mint", getTicketByMint);             // GET /api/tickets/:mint

export default router;
