import type { Request, Response, NextFunction } from "express";
import { ApiError, RequestValidationError } from "./requestValidation.ts";

function property(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error("[error]", err);

  const rawStatus = property(err, "status") ?? property(err, "statusCode");
  const name = property(err, "name");
  const status = typeof rawStatus === "number" && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : name === "ValidationError" || name === "CastError" || property(err, "type") === "entity.parse.failed"
      ? 400
      : property(err, "code") === 11000
        ? 409
        : 500;
  const message = err instanceof Error ? err.message : "Internal server error";
  const errorCode = err instanceof RequestValidationError || err instanceof ApiError
    ? err.code
    : name === "ValidationError" || name === "CastError" || property(err, "type") === "entity.parse.failed"
      ? "INVALID_REQUEST"
      : property(err, "code") === 11000
        ? "CONFLICT"
        : typeof property(err, "code") === "string"
          ? String(property(err, "code"))
          : status === 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR";

  res.status(status).json({ error: { code: errorCode, message } });
}
