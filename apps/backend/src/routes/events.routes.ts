import { Router } from "express";
import {
  createEvent,
  getAllEvents,
  getEventById,
  getEventsByOrganizer,
  updateEvent,
} from "../controllers/event.controller";

const router = Router();

// Public
router.get("/", getAllEvents);              // GET  /api/events
router.get("/:id", getEventById);           // GET  /api/events/:id

// Organizer-facing
router.post("/", createEvent);              // POST /api/events
router.get("/organizer/:pubkey", getEventsByOrganizer); // GET /api/events/organizer/:pubkey
router.patch("/:id", updateEvent);          // PATCH /api/events/:id

export default router;