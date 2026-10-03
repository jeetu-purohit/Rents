import { Router } from "express";
import {
  getTicketsByOwner,
  getTicketsByEvent,
  getTicketByMint,
  getActiveListings,
  syncTicketByMint,
} from "../controllers/ticket.controller";
import { publicKeyString, validateParams } from "../middleware/requestValidation";

const router = Router();

// Read (served from Mongo cache, synced by indexer)
router.get("/owner/:pubkey", validateParams({ pubkey: publicKeyString }), getTicketsByOwner);   // GET /api/tickets/owner/:pubkey
router.get("/event/:eventId", validateParams({ eventId: publicKeyString }), getTicketsByEvent);  // GET /api/tickets/event/:eventId (Event PDA)
router.get("/listings", getActiveListings);        // GET /api/tickets/listings
router.post("/:mint/sync", validateParams({ mint: publicKeyString }), syncTicketByMint);      // POST /api/tickets/:mint/sync
router.get("/:mint", validateParams({ mint: publicKeyString }), getTicketByMint);             // GET /api/tickets/:mint

export default router;
