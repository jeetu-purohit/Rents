import type { Request, Response, NextFunction } from "express";
import type { CreateEventRequest } from "shared";
import { Event } from "../models/Event.model.js";
import { ApiError } from "../middleware/requestValidation.js";

export async function createEvent(
  req: Request<Record<string, string>, unknown, CreateEventRequest>,
  res: Response,
  next: NextFunction
) {
  try {
    // TODO: this should run AFTER the frontend confirms the on-chain
    // initialize_event tx, passing back onChainEventId and eventPda.
    const event = await Event.create(req.body);
    res.status(201).json(event);
  } catch (err) {
    next(err);
  }
}

export async function getAllEvents(req: Request, res: Response, next: NextFunction) {
  try {
    const events = await Event.find().sort({ date: 1 });
    res.json(events);
  } catch (err) {
    next(err);
  }
}

export async function getEventById(req: Request, res: Response, next: NextFunction) {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) throw new ApiError("Event not found", 404, "NOT_FOUND");
    res.json(event);
  } catch (err) {
    next(err);
  }
}

export async function getEventsByOrganizer(req: Request, res: Response, next: NextFunction) {
  try {
    const events = await Event.find({ organizerPubkey: req.params.pubkey }).sort({ date: 1 });
    res.json(events);
  } catch (err) {
    next(err);
  }
}

export async function updateEvent(req: Request, res: Response, next: NextFunction) {
  try {
    // TODO: verify req signer === event.organizerPubkey before allowing this
    const event = await Event.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!event) throw new ApiError("Event not found", 404, "NOT_FOUND");
    res.json(event);
  } catch (err) {
    next(err);
  }
}
