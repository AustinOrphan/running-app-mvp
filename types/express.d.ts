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
