import { asyncHandler, asyncAuthHandler, asyncHandlerGeneric } from '../../../server/middleware/asyncHandler.js';
import type { Request, Response, NextFunction } from 'express';

describe('AsyncHandler Middleware - Complete Coverage', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {};
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  describe('asyncHandlerGeneric', () => {
    it('should handle successful async operations', async () => {
      const successHandler = asyncHandlerGeneric(async (req: Request, res: Response, next: NextFunction) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        res.json({ success: true });
      });

      await successHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({ success: true });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should catch and pass async errors to next', async () => {
      const testError = new Error('Async error');
      const errorHandler = asyncHandlerGeneric(async (req: Request, res: Response, next: NextFunction) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw testError;
      });

      await errorHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(testError);
      expect(mockResponse.json).not.toHaveBeenCalled();
    });

    it('should handle synchronous errors', async () => {
      const testError = new Error('Sync error');
      const errorHandler = asyncHandlerGeneric((req: Request, res: Response, next: NextFunction) => {
        throw testError;
      });

      await errorHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(testError);
    });

    it('should handle Promise rejections', async () => {
      const testError = new Error('Promise rejection');
      const rejectHandler = asyncHandlerGeneric(async (req: Request, res: Response, next: NextFunction) => {
        return Promise.reject(testError);
      });

      await rejectHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(testError);
    });

    it('should handle handlers that return void', async () => {
      const voidHandler = asyncHandlerGeneric(async (req: Request, res: Response, next: NextFunction) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        // No return statement
      });

      await voidHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle handlers that return promises', async () => {
      const promiseHandler = asyncHandlerGeneric((req: Request, res: Response, next: NextFunction) => {
        return new Promise((resolve) => {
          setTimeout(() => {
            res.json({ delayed: true });
            resolve(undefined);
          }, 10);
        });
      });

      await promiseHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({ delayed: true });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('asyncHandler', () => {
    it('should handle successful operations', async () => {
      const handler = asyncHandler(async (req: Request, res: Response) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        res.json({ data: 'test' });
      });

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({ data: 'test' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should catch and forward errors', async () => {
      const testError = new Error('Handler error');
      const handler = asyncHandler(async (req: Request, res: Response) => {
        throw testError;
      });

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(testError);
    });

    it('should work with non-async handlers', async () => {
      const handler = asyncHandler((req: Request, res: Response) => {
        res.json({ sync: true });
      });

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({ sync: true });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('asyncAuthHandler', () => {
    it('should handle successful authenticated operations', async () => {
      mockRequest.user = { id: 1, email: 'test@example.com' };
      
      const handler = asyncAuthHandler(async (req: Request, res: Response) => {
        res.json({ user: req.user });
      });

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({ 
        user: { id: 1, email: 'test@example.com' } 
      });
    });

    it('should catch and forward authentication errors', async () => {
      const authError = new Error('Authentication failed');
      const handler = asyncAuthHandler(async (req: Request, res: Response) => {
        throw authError;
      });

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(authError);
    });

    it('should work with user-specific operations', async () => {
      mockRequest.user = { id: 123, email: 'user@example.com' };
      
      const handler = asyncAuthHandler(async (req: Request, res: Response) => {
        const userId = req.user?.id;
        res.json({ userId });
      });

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({ userId: 123 });
    });

    it('should handle missing user context gracefully', async () => {
      mockRequest.user = undefined;
      
      const handler = asyncAuthHandler(async (req: Request, res: Response) => {
        res.json({ user: req.user || null });
      });

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({ user: null });
    });
  });

  describe('Error handling edge cases', () => {
    it('should handle non-Error objects thrown', async () => {
      const handler = asyncHandler(async (req: Request, res: Response) => {
        throw 'String error';
      });

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith('String error');
    });

    it('should handle null/undefined errors', async () => {
      const handler = asyncHandler(async (req: Request, res: Response) => {
        throw null;
      });

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(null);
    });

    it('should handle complex async chains', async () => {
      const handler = asyncHandler(async (req: Request, res: Response) => {
        const step1 = await Promise.resolve(1);
        const step2 = await Promise.resolve(step1 + 1);
        const step3 = await Promise.resolve(step2 * 2);
        res.json({ result: step3 });
      });

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({ result: 4 });
    });

    it('should handle errors in complex async chains', async () => {
      const chainError = new Error('Chain error');
      const handler = asyncHandler(async (req: Request, res: Response) => {
        const step1 = await Promise.resolve(1);
        await Promise.resolve(step1 + 1);
        throw chainError;
      });

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(chainError);
    });
  });

  describe('Performance and memory handling', () => {
    it('should handle multiple concurrent operations', async () => {
      const handler = asyncHandler(async (req: Request, res: Response) => {
        const promises = Array.from({ length: 5 }, (_, i) => 
          Promise.resolve(i).then(n => n * 2)
        );
        const results = await Promise.all(promises);
        res.json({ results });
      });

      await handler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({ 
        results: [0, 2, 4, 6, 8] 
      });
    });

    it('should handle operations with timeouts', async () => {
      jest.useFakeTimers();
      
      const handler = asyncHandler(async (req: Request, res: Response) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        res.json({ completed: true });
      });

      const handlerPromise = handler(mockRequest as Request, mockResponse as Response, mockNext);
      
      jest.advanceTimersByTime(1000);
      await handlerPromise;

      expect(mockResponse.json).toHaveBeenCalledWith({ completed: true });
      
      jest.useRealTimers();
    });
  });
});