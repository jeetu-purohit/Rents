import { Router } from "express";
import {
  buildInitializeEventTransaction,
  buildMintTicketTransaction,
  buildListTicketTransaction,
  buildCancelListingTransaction,
  buildResellTicketTransaction,
  buildCheckInTicketTransaction,
} from "../controllers/tx.controller";
import { integer, publicKeyString, requiredString, u64String, validateBody } from "../middleware/requestValidation";

const router = Router();

router.post("/initialize-event", validateBody({
  organizerPubkey: publicKeyString,
  eventId: u64String,
  maxTickets: (value: unknown, field: string) => integer(value, field, 1, 0xffff_ffff),
  basePriceLamports: u64String,
  resaleCapBps: (value: unknown, field: string) => integer(value, field, 10_000, 0xffff),
  royaltyBps: (value: unknown, field: string) => integer(value, field, 0, 2_000),
}), buildInitializeEventTransaction);
router.post("/mint", validateBody({
  buyerPubkey: publicKeyString,
  eventPda: publicKeyString,
  mintPubkey: publicKeyString,
  eventName: requiredString,
  uri: requiredString,
}), buildMintTicketTransaction);
router.post("/list", validateBody({
  holderPubkey: publicKeyString,
  mintPubkey: publicKeyString,
  priceLamports: u64String,
}), buildListTicketTransaction);
router.post("/cancel-listing", validateBody({
  holderPubkey: publicKeyString,
  mintPubkey: publicKeyString,
}), buildCancelListingTransaction);
router.post("/resell", validateBody({
  buyerPubkey: publicKeyString,
  sellerPubkey: publicKeyString,
  mintPubkey: publicKeyString,
}), buildResellTicketTransaction);
router.post("/check-in", validateBody({
  organizerPubkey: publicKeyString,
  holderPubkey: publicKeyString,
  mintPubkey: publicKeyString,
}), buildCheckInTicketTransaction);

export default router;
