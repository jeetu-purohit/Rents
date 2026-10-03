import { Router } from "express";
import {
  buildInitializeEventTransaction,
  buildMintTicketTransaction,
} from "../controllers/tx.controller";

const router = Router();

router.post("/initialize-event", buildInitializeEventTransaction);
router.post("/mint", buildMintTicketTransaction);

export default router;
