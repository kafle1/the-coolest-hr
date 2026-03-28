import { Prisma } from "@prisma/client";

const NOT_FOUND_PATTERNS = [
  "not found",
  "does not exist",
  "no longer exists",
  "no longer available",
  "no longer active",
];

const CONFLICT_PATTERNS = [
  "already",
  "not ready",
  "must be",
  "is not scheduled",
  "is not valid",
  "not valid for",
];

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

function statusFromMessage(message: string) {
  const lower = message.toLowerCase();

  if (NOT_FOUND_PATTERNS.some((p) => lower.includes(p))) return 404;
  if (CONFLICT_PATTERNS.some((p) => lower.includes(p))) return 409;

  return 400;
}

export function badRequest(message: string, code = "bad_request") {
  return new AppError(message, 400, code);
}

export function notFound(message: string, code = "not_found") {
  return new AppError(message, 404, code);
}

export function conflict(message: string, code = "conflict") {
  return new AppError(message, 409, code);
}

export function errorToStatusCode(error: unknown): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    return 404;
  }

  if (typeof error === "string") {
    return statusFromMessage(error);
  }

  if (error instanceof Error) {
    return statusFromMessage(error.message);
  }

  return 500;
}

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
