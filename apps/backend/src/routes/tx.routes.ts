import { Router } from "express";
import {
  buildInitializeEventTransaction,
  buildMintTicketTransaction,
  buildListTicketTransaction,
  buildCancelListingTransaction,
  buildResellTicketTransaction,
  buildCheckInTicketTransaction,
} from "../controllers/tx.controller";

const router = Router();

router.post("/initialize-event", buildInitializeEventTransaction);
router.post("/mint", buildMintTicketTransaction);
router.post("/list", buildListTicketTransaction);
router.post("/cancel-listing", buildCancelListingTransaction);
router.post("/resell", buildResellTicketTransaction);
router.post("/check-in", buildCheckInTicketTransaction);

export default router;
