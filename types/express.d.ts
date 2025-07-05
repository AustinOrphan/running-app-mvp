import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      user?: {
        id: string;
        email: string;
      };
    }
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    correlationId?: string;
    user?: {
      id: string;
      email: string;
    };
  }
}

export {};
