import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import type { ILogger } from '../logger.js';

export const REQUEST_ID_HEADER = 'x-request-id';
export const TRACE_ID_HEADER = 'x-trace-id';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    traceId?: string;
    logger: ILogger;
  }
}

export interface FastifyLoggerPluginOptions {
  logger: ILogger;
  component?: string;
  generateRequestId?: () => string;
  extractUserId?: (req: FastifyRequest) => string | undefined;
  skipPaths?: string[];
}

export async function fastifyLoggerPlugin(
  fastify: FastifyInstance,
  options: FastifyLoggerPluginOptions
): Promise<void> {
  const {
    logger,
    component = 'api',
    generateRequestId = uuidv4,
    extractUserId,
    skipPaths = [],
  } = options;

  fastify.addHook('onRequest', async (request, reply) => {
    if (skipPaths.some((path) => request.url.startsWith(path))) {
      return;
    }

    const requestId =
      (request.headers[REQUEST_ID_HEADER] as string) || generateRequestId();
    const traceId = request.headers[TRACE_ID_HEADER] as string | undefined;
    const userId = extractUserId ? extractUserId(request) : undefined;

    request.requestId = requestId;
    request.traceId = traceId;

    request.logger = logger.child({
      requestId,
      traceId,
      userId,
      component,
    });

    reply.header(REQUEST_ID_HEADER, requestId);
  });

  fastify.addHook('onResponse', async (request, reply) => {
    if (skipPaths.some((path) => request.url.startsWith(path))) {
      return;
    }

    const duration = reply.elapsedTime;
    const level = reply.statusCode >= 500 ? 'error' : 'info';

    const logMethod = request.logger[level].bind(request.logger);
    logMethod(`${request.method} ${request.url} ${reply.statusCode}`, {
      operation: 'http-request',
      context: {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        duration,
        userAgent: request.headers['user-agent'],
      },
    });
  });

  fastify.addHook('onError', async (request, reply, error) => {
    request.logger.error('Request error', {
      component,
      operation: 'error-handler',
      context: {
        error,
        method: request.method,
        url: request.url,
      },
    });
  });
}

export default fastifyLoggerPlugin;
