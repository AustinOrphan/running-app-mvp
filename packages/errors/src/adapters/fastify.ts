import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { errorToResponse } from "../errors.js";

/**
 * Options for Fastify error handler
 */
export type FastifyErrorHandlerOptions = {
  includeStack?: boolean;
  includeDetails?: boolean;
};

/**
 * Fastify error handler
 *
 * Usage:
 * ```typescript
 * import Fastify from "fastify";
 * import { createFastifyErrorHandler } from "@AustinOrphan/errors";
 *
 * const fastify = Fastify();
 *
 * // Set error handler
 * fastify.setErrorHandler(createFastifyErrorHandler({
 *   includeStack: process.env.NODE_ENV !== "production",
 *   includeDetails: process.env.NODE_ENV !== "production"
 * }));
 * ```
 *
 * @param options - Configuration options
 * @returns Fastify error handler function
 */
export function createFastifyErrorHandler(
  options: FastifyErrorHandlerOptions = {}
) {
  const { includeStack = false, includeDetails = false } = options;

  return async (
    error: FastifyError | Error,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const requestId = (request.headers["x-request-id"] as string) ||
                      crypto.randomUUID();

    const errorResponse = errorToResponse(
      error,
      requestId,
      request.url,
      request.method,
      includeStack,
      includeDetails
    );

    await reply.status(errorResponse.statusCode).send(errorResponse);
  };
}
