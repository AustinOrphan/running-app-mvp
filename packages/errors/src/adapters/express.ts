import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { errorToResponse } from "../errors.js";

/**
 * Options for Express error handler
 */
export type ExpressErrorHandlerOptions = {
  includeStack?: boolean;
  includeDetails?: boolean;
};

/**
 * Express error handler middleware
 *
 * Usage:
 * ```typescript
 * import express from "express";
 * import { createExpressErrorHandler } from "@AustinOrphan/errors";
 *
 * const app = express();
 *
 * // ... your routes ...
 *
 * // Add error handler as last middleware
 * app.use(createExpressErrorHandler({
 *   includeStack: process.env.NODE_ENV !== "production",
 *   includeDetails: process.env.NODE_ENV !== "production"
 * }));
 * ```
 *
 * @param options - Configuration options
 * @returns Express error handler middleware
 */
export function createExpressErrorHandler(
  options: ExpressErrorHandlerOptions = {}
): ErrorRequestHandler {
  const { includeStack = false, includeDetails = false } = options;

  return (
    err: Error,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    next: NextFunction
  ): void => {
    const requestId = (req.headers["x-request-id"] as string) ||
                      crypto.randomUUID();

    const errorResponse = errorToResponse(
      err,
      requestId,
      req.path,
      req.method,
      includeStack,
      includeDetails
    );

    res.status(errorResponse.statusCode).json(errorResponse);
  };
}
