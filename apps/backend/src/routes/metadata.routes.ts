import { Router } from "express";
import { getTicketMetadataController } from "../controllers/metadata.controller";

const router = Router();

router.get("/:mint", getTicketMetadataController);

export default router;
