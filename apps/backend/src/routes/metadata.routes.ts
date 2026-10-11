import { Router } from "express";
import { getTicketMetadataController } from "../controllers/metadata.controller.js";
import { publicKeyString, validateParams } from "../middleware/requestValidation.js";

const router = Router();

router.get("/:mint", validateParams({ mint: publicKeyString }), getTicketMetadataController);

export default router;
