import { Router } from "express";
import { getPlatformConfigController } from "../controllers/platform.controller.js";

const router = Router();

router.get("/", getPlatformConfigController);

export default router;
