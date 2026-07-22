import { describe, it, expect, vi } from "vitest";
import type { FastifyRequest, FastifyReply } from "fastify";
import { createFastifyErrorHandler } from "../../src/adapters/fastify.js";
import {
  NotFoundError,
  ValidationError,
  AuthenticationError,
} from "../../src/errors.js";

describe("Fastify Adapter", () => {
  describe("createFastifyErrorHandler", () => {
    it("should handle StandardError correctly", async () => {
      const handler = createFastifyErrorHandler();
      const error = new NotFoundError("User not found");

      const request = {
        url: "/api/users/123",
        method: "GET",
        headers: {
          "x-request-id": "req-123",
        },
      } as unknown as FastifyRequest;

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as FastifyReply;

      await handler(error, request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(
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

      const response = (reply.send as any).mock.calls[0][0];
      expect(response.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
      );
      expect(response.stack).toBeUndefined();
      expect(response.details).toBeUndefined();
    });

    it("should generate requestId if not provided", async () => {
      const handler = createFastifyErrorHandler();
      const error = new NotFoundError("User not found");

      const request = {
        url: "/api/users/123",
        method: "GET",
        headers: {},
      } as unknown as FastifyRequest;

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as FastifyReply;

      await handler(error, request, reply);

      const response = (reply.send as any).mock.calls[0][0];
      expect(response.requestId).toBeDefined();
      expect(response.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("should include stack trace when includeStack is true", async () => {
      const handler = createFastifyErrorHandler({ includeStack: true });
      const error = new NotFoundError("User not found");

      const request = {
        url: "/api/users/123",
        method: "GET",
        headers: { "x-request-id": "req-123" },
      } as unknown as FastifyRequest;

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as FastifyReply;

      await handler(error, request, reply);

      const response = (reply.send as any).mock.calls[0][0];
      expect(response.stack).toBeDefined();
      expect(response.stack).toContain("NotFoundError");
    });

    it("should include details when includeDetails is true", async () => {
      const handler = createFastifyErrorHandler({ includeDetails: true });
      const error = new NotFoundError("User not found", { userId: "123" });

      const request = {
        url: "/api/users/123",
        method: "GET",
        headers: { "x-request-id": "req-123" },
      } as unknown as FastifyRequest;

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as FastifyReply;

      await handler(error, request, reply);

      const response = (reply.send as any).mock.calls[0][0];
      expect(response.details).toEqual({ userId: "123" });
    });

    it("should handle ValidationError with field", async () => {
      const handler = createFastifyErrorHandler();
      const error = new ValidationError("Email is invalid", "email");

      const request = {
        url: "/api/users",
        method: "POST",
        headers: { "x-request-id": "req-456" },
      } as unknown as FastifyRequest;

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as FastifyReply;

      await handler(error, request, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      const response = (reply.send as any).mock.calls[0][0];
      expect(response.code).toBe("VALIDATION_ERROR");
      expect(response.field).toBe("email");
    });

    it("should handle generic Error", async () => {
      const handler = createFastifyErrorHandler();
      const error = new Error("Unexpected error");

      const request = {
        url: "/api/test",
        method: "POST",
        headers: { "x-request-id": "req-789" },
      } as unknown as FastifyRequest;

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as FastifyReply;

      await handler(error, request, reply);

      expect(reply.status).toHaveBeenCalledWith(500);
      const response = (reply.send as any).mock.calls[0][0];
      expect(response.code).toBe("INTERNAL_ERROR");
      expect(response.message).toBe("Unexpected error");
    });

    it("should handle all error types correctly", async () => {
      const handler = createFastifyErrorHandler();

      const testCases = [
        { error: new NotFoundError("test"), expectedStatus: 404 },
        { error: new ValidationError("test"), expectedStatus: 400 },
        { error: new AuthenticationError("test"), expectedStatus: 401 },
      ];

      for (const { error, expectedStatus } of testCases) {
        const request = {
          url: "/api/test",
          method: "GET",
          headers: { "x-request-id": "req-123" },
        } as unknown as FastifyRequest;

        const reply = {
          status: vi.fn().mockReturnThis(),
          send: vi.fn().mockResolvedValue(undefined),
        } as unknown as FastifyReply;

        await handler(error, request, reply);

        expect(reply.status).toHaveBeenCalledWith(expectedStatus);
      }
    });

    it("should include both stack and details when both options are true", async () => {
      const handler = createFastifyErrorHandler({
        includeStack: true,
        includeDetails: true,
      });
      const error = new ValidationError("Invalid email", "email", {
        pattern: "email",
      });

      const request = {
        url: "/api/users",
        method: "POST",
        headers: { "x-request-id": "req-123" },
      } as unknown as FastifyRequest;

      const reply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as FastifyReply;

      await handler(error, request, reply);

      const response = (reply.send as any).mock.calls[0][0];
      expect(response.stack).toBeDefined();
      expect(response.details).toEqual({ pattern: "email" });
      expect(response.field).toBe("email");
    });
  });
});
