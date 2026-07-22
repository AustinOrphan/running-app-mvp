import type { ILogger } from '../logger.js';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      traceId?: string;
      logger?: ILogger;
    }
  }
}
