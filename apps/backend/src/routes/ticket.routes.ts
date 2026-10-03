import { Router } from "express";
import {
  getTicketsByOwner,
  getTicketsByEvent,
  getTicketByMint,
  getActiveListings,
  syncTicketByMint,
} from "../controllers/ticket.controller";

const router = Router();

// Read (served from Mongo cache, synced by indexer)
router.get("/owner/:pubkey", getTicketsByOwner);   // GET /api/tickets/owner/:pubkey
router.get("/event/:eventId", getTicketsByEvent);  // GET /api/tickets/event/:eventId
router.get("/listings", getActiveListings);        // GET /api/tickets/listings
router.post("/:mint/sync", syncTicketByMint);      // POST /api/tickets/:mint/sync
router.get("/:mint", getTicketByMint);             // GET /api/tickets/:mint

export default router;
