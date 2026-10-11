import express from "express";
import cors from "cors";
import { connectDB } from "./config/db";
import eventRoutes from "./routes/events.routes.ts";
import ticketRoutes from "./routes/ticket.routes";
import checkinRoutes from "./routes/checkin.routes";
import txRoutes from "./routes/tx.routes";
import metadataRoutes from "./routes/metadata.routes";
import platformRoutes from "./routes/platform.routes";
import { errorHandler } from "./middleware/errorHandler";
import { ApiError, rejectUnsupportedQueryParams } from "./middleware/requestValidation";
import { startIndexer } from "./services/indexer.service";

const app = express();
const PORT = process.env.PORT || 4000;
const frontendOrigin = process.env.FRONTEND_ORIGIN?.trim().replace(/\/+$/, "");

if (!frontendOrigin) {
  throw new Error("FRONTEND_ORIGIN must be configured");
}

app.use(
  cors({
    origin: frontendOrigin,
    credentials: true,
  })
);

app.options(/.*/, cors({
  origin: frontendOrigin,
  credentials: true,
}));
app.use(express.json());
app.use(rejectUnsupportedQueryParams);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/events", eventRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/checkin", checkinRoutes);
app.use("/api/tx", txRoutes);
app.use("/api/metadata", metadataRoutes);
app.use("/api/platform", platformRoutes);

app.use((_req, _res, next) => next(new ApiError("Route not found", 404, "NOT_FOUND")));
app.use(errorHandler);

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`[server] RENTS backend running on port ${PORT}`);
    if (process.env.INDEXER_ENABLED?.trim().toLowerCase() === "true") startIndexer();
  });
}

start();
