import { Router } from "express";
import { getTicketMetadataController } from "../controllers/metadata.controller.ts";
import { publicKeyString, validateParams } from "../middleware/requestValidation.ts";

const router = Router();

router.get("/:mint", validateParams({ mint: publicKeyString }), getTicketMetadataController);

export default router;
