import { Router } from "express";
import { getTicketMetadataController } from "../controllers/metadata.controller";
import { publicKeyString, validateParams } from "../middleware/requestValidation";

const router = Router();

router.get("/:mint", validateParams({ mint: publicKeyString }), getTicketMetadataController);

export default router;
