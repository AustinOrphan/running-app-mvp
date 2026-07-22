import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createExpressErrorHandler } from "../../src/adapters/express.js";
import {
  NotFoundError,
  ValidationError,
  AuthenticationError,
} from "../../src/errors.js";

describe("Express Adapter", () => {
  describe("createExpressErrorHandler", () => {
    it("should handle StandardError correctly", () => {
      const handler = createExpressErrorHandler();
      const error = new NotFoundError("User not found");

      const req = {
        path: "/api/users/123",
        method: "GET",
        headers: {
          "x-request-id": "req-123",
        },
      } as unknown as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      handler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: true,
          code: "NOT_FOUND",
          message: "User not found",
          statusCode: 404,
          requestId: "req-123",
          path: "/api/users/123",
          method: "GET",
        })
      );

      const response = (res.json as any).mock.calls[0][0];
      expect(response.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
      );
      expect(response.stack).toBeUndefined();
      expect(response.details).toBeUndefined();
    });

    it("should generate requestId if not provided", () => {
      const handler = createExpressErrorHandler();
      const error = new NotFoundError("User not found");

      const req = {
        path: "/api/users/123",
        method: "GET",
        headers: {},
      } as unknown as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      handler(error, req, res, next);

      const response = (res.json as any).mock.calls[0][0];
      expect(response.requestId).toBeDefined();
      expect(response.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("should include stack trace when includeStack is true", () => {
      const handler = createExpressErrorHandler({ includeStack: true });
      const error = new NotFoundError("User not found");

      const req = {
        path: "/api/users/123",
        method: "GET",
        headers: { "x-request-id": "req-123" },
      } as unknown as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      handler(error, req, res, next);

      const response = (res.json as any).mock.calls[0][0];
      expect(response.stack).toBeDefined();
      expect(response.stack).toContain("NotFoundError");
    });

    it("should include details when includeDetails is true", () => {
      const handler = createExpressErrorHandler({ includeDetails: true });
      const error = new NotFoundError("User not found", { userId: "123" });

      const req = {
        path: "/api/users/123",
        method: "GET",
        headers: { "x-request-id": "req-123" },
      } as unknown as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      handler(error, req, res, next);

      const response = (res.json as any).mock.calls[0][0];
      expect(response.details).toEqual({ userId: "123" });
    });

    it("should handle ValidationError with field", () => {
      const handler = createExpressErrorHandler();
      const error = new ValidationError("Email is invalid", "email");

      const req = {
        path: "/api/users",
        method: "POST",
        headers: { "x-request-id": "req-456" },
      } as unknown as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      handler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      const response = (res.json as any).mock.calls[0][0];
      expect(response.code).toBe("VALIDATION_ERROR");
      expect(response.field).toBe("email");
    });

    it("should handle generic Error", () => {
      const handler = createExpressErrorHandler();
      const error = new Error("Unexpected error");

      const req = {
        path: "/api/test",
        method: "POST",
        headers: { "x-request-id": "req-789" },
      } as unknown as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      handler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      const response = (res.json as any).mock.calls[0][0];
      expect(response.code).toBe("INTERNAL_ERROR");
      expect(response.message).toBe("Unexpected error");
    });

    it("should handle all error types correctly", () => {
      const handler = createExpressErrorHandler();

      const testCases = [
        { error: new NotFoundError("test"), expectedStatus: 404 },
        { error: new ValidationError("test"), expectedStatus: 400 },
        { error: new AuthenticationError("test"), expectedStatus: 401 },
      ];

      for (const { error, expectedStatus } of testCases) {
        const req = {
          path: "/api/test",
          method: "GET",
          headers: { "x-request-id": "req-123" },
        } as unknown as Request;

        const res = {
          status: vi.fn().mockReturnThis(),
          json: vi.fn(),
        } as unknown as Response;

        const next = vi.fn() as NextFunction;

        handler(error, req, res, next);

        expect(res.status).toHaveBeenCalledWith(expectedStatus);
      }
    });

    it("should include both stack and details when both options are true", () => {
      const handler = createExpressErrorHandler({
        includeStack: true,
        includeDetails: true,
      });
      const error = new ValidationError("Invalid email", "email", {
        pattern: "email",
      });

      const req = {
        path: "/api/users",
        method: "POST",
        headers: { "x-request-id": "req-123" },
      } as unknown as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      handler(error, req, res, next);

      const response = (res.json as any).mock.calls[0][0];
      expect(response.stack).toBeDefined();
      expect(response.details).toEqual({ pattern: "email" });
      expect(response.field).toBe("email");
    });
  });
});
