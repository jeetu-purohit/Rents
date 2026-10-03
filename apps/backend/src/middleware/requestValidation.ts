import type { NextFunction, Request, RequestHandler, Response } from "express";
import { PublicKey } from "@solana/web3.js";

export class RequestValidationError extends Error {
  readonly status = 400;
  readonly code = "VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code = "REQUEST_ERROR") {
    super(message);
    this.name = "ApiError";
  }
}

type Validator = (value: unknown, field: string) => void;
type FieldRules = Record<string, Validator>;

export function requestObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RequestValidationError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RequestValidationError(`${field} must be a non-empty string`);
  }
}

export function optionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new RequestValidationError(`${field} must be a string`);
  }
}

export function publicKeyString(value: unknown, field: string): void {
  requiredString(value, field);
  try {
    new PublicKey(value as string);
  } catch {
    throw new RequestValidationError(`${field} must be a valid Solana public key`);
  }
}

export function u64String(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new RequestValidationError(`${field} must be a decimal integer string`);
  }
  if (BigInt(value) > 18_446_744_073_709_551_615n) {
    throw new RequestValidationError(`${field} exceeds the u64 range`);
  }
}

export function integer(value: unknown, field: string, minimum: number, maximum: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RequestValidationError(`${field} must be an integer from ${minimum} to ${maximum}`);
  }
}

export function validDateString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    throw new RequestValidationError(`${field} must be a valid date string`);
  }
}

export function mongoId(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) {
    throw new RequestValidationError(`${field} must be a valid event ID`);
  }
}

function validateFields(value: unknown, label: string, fields: FieldRules): void {
  const object = requestObject(value, label);
  const unknownField = Object.keys(object).find((field) => !(field in fields));
  if (unknownField) throw new RequestValidationError(`${unknownField} is not a supported ${label.toLowerCase()} field`);
  for (const [field, validator] of Object.entries(fields)) validator(object[field], field);
}

export function validateParams(fields: FieldRules): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      validateFields(req.params, "Route parameters", fields);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateBody(fields: FieldRules, options: { allowPartial?: boolean } = {}): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const body = requestObject(req.body, "Request body");
      const entries = Object.entries(fields);
      if (options.allowPartial && !entries.some(([field]) => body[field] !== undefined)) {
        throw new RequestValidationError("Request body must include at least one supported field");
      }
      for (const [field, validator] of entries) {
        if (options.allowPartial && body[field] === undefined) continue;
        validator(body[field], field);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const rejectUnsupportedQueryParams: RequestHandler = (req, _res, next) => {
  if (Object.keys(req.query).length > 0) {
    next(new RequestValidationError("This route does not accept query parameters"));
    return;
  }
  next();
};
