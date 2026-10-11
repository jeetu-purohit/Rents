import { Router } from "express";
import {
  createEvent,
  getAllEvents,
  getEventById,
  getEventsByOrganizer,
  updateEvent,
} from "../controllers/event.controller.ts";
import { integer, mongoId, optionalString, publicKeyString, requiredString, u64String, validDateString, validateBody, validateParams } from "../middleware/requestValidation.ts";

const router = Router();

// Public
router.get("/", getAllEvents);              // GET  /api/events
const eventIdParam = validateParams({ id: mongoId });
router.get("/:id", eventIdParam, getEventById);           // GET  /api/events/:id

// Organizer-facing
const eventFields = {
  onChainEventId: u64String,
  organizerPubkey: publicKeyString,
  eventPda: publicKeyString,
  name: requiredString,
  description: requiredString,
  venue: requiredString,
  date: validDateString,
  imageUrl: optionalString,
  maxTickets: (value: unknown, field: string) => integer(value, field, 1, 0xffff_ffff),
  basePriceLamports: u64String,
  resaleCapBps: (value: unknown, field: string) => integer(value, field, 10_000, 0xffff),
  royaltyBps: (value: unknown, field: string) => integer(value, field, 0, 2_000),
};
router.post("/", validateBody(eventFields), createEvent);              // POST /api/events
router.get("/organizer/:pubkey", validateParams({ pubkey: publicKeyString }), getEventsByOrganizer); // GET /api/events/organizer/:pubkey
router.patch("/:id", eventIdParam, validateBody(eventFields, { allowPartial: true }), updateEvent); // PATCH /api/events/:id

export default router;
