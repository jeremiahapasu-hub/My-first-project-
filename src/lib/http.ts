import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Thrown by route handlers to short-circuit with a specific status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthorized = (msg = "Sign in to continue") =>
  new ApiError(401, msg);
export const forbidden = (msg = "Your role does not allow this action") =>
  new ApiError(403, msg);
export const notFound = (msg = "Not found") => new ApiError(404, msg);
export const badRequest = (msg: string, details?: unknown) =>
  new ApiError(400, msg, details);

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/**
 * Wraps a route handler so every failure leaves as a predictable JSON envelope.
 *
 * Unexpected errors are logged server-side but never echoed to the client — the
 * message could carry a connection string or a stack path.
 */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json(
          { error: error.message, details: error.details ?? null },
          { status: error.status },
        );
      }

      if (error instanceof ZodError) {
        return NextResponse.json(
          {
            // Covers both bodies and query parameters — `path` says which field.
            error: "The request did not validate",
            details: error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
          { status: 422 },
        );
      }

      console.error("[api] unhandled error:", error);

      return NextResponse.json(
        { error: "Something went wrong on our end" },
        { status: 500 },
      );
    }
  };
}
