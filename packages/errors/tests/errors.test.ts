import { describe, it, expect } from "vitest";
import {
  StandardError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  DatabaseError,
  createNotFoundError,
  createValidationError,
  createAuthError,
  createForbiddenError,
  createConflictError,
  createDatabaseError,
  errorToHTTPStatus,
  errorToResponse,
} from "../src/errors.js";

describe("StandardError", () => {
  it("should create a standard error with all properties", () => {
    const error = new StandardError(
      "Test error",
      "TEST_ERROR",
      500,
      { key: "value" },
      "testField"
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(StandardError);
    expect(error.message).toBe("Test error");
    expect(error.code).toBe("TEST_ERROR");
    expect(error.statusCode).toBe(500);
    expect(error.details).toEqual({ key: "value" });
    expect(error.field).toBe("testField");
    expect(error.name).toBe("StandardError");
    expect(error.stack).toBeDefined();
  });

  it("should create a standard error without optional fields", () => {
    const error = new StandardError("Test error", "TEST_ERROR", 500);

    expect(error.message).toBe("Test error");
    expect(error.code).toBe("TEST_ERROR");
    expect(error.statusCode).toBe(500);
    expect(error.details).toBeUndefined();
    expect(error.field).toBeUndefined();
  });
});

describe("NotFoundError", () => {
  it("should create a NotFoundError with correct properties", () => {
    const error = new NotFoundError("Resource not found");

    expect(error).toBeInstanceOf(StandardError);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toBe("Resource not found");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.statusCode).toBe(404);
    expect(error.name).toBe("NotFoundError");
  });

  it("should create a NotFoundError with details", () => {
    const error = new NotFoundError("Resource not found", { id: "123" });

    expect(error.details).toEqual({ id: "123" });
  });
});

describe("ValidationError", () => {
  it("should create a ValidationError with field", () => {
    const error = new ValidationError("Invalid email", "email");

    expect(error).toBeInstanceOf(StandardError);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe("Invalid email");
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.statusCode).toBe(400);
    expect(error.field).toBe("email");
    expect(error.name).toBe("ValidationError");
  });

  it("should create a ValidationError with field and details", () => {
    const error = new ValidationError("Invalid email", "email", {
      pattern: "email",
    });

    expect(error.field).toBe("email");
    expect(error.details).toEqual({ pattern: "email" });
  });

  it("should create a ValidationError without field", () => {
    const error = new ValidationError("Invalid data");

    expect(error.field).toBeUndefined();
  });
});

describe("AuthenticationError", () => {
  it("should create an AuthenticationError", () => {
    const error = new AuthenticationError("Invalid credentials");

    expect(error).toBeInstanceOf(StandardError);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.message).toBe("Invalid credentials");
    expect(error.code).toBe("AUTHENTICATION_ERROR");
    expect(error.statusCode).toBe(401);
    expect(error.name).toBe("AuthenticationError");
  });

  it("should create an AuthenticationError with details", () => {
    const error = new AuthenticationError("Invalid token", { expired: true });

    expect(error.details).toEqual({ expired: true });
  });
});

describe("AuthorizationError", () => {
  it("should create an AuthorizationError", () => {
    const error = new AuthorizationError("Forbidden");

    expect(error).toBeInstanceOf(StandardError);
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error.message).toBe("Forbidden");
    expect(error.code).toBe("AUTHORIZATION_ERROR");
    expect(error.statusCode).toBe(403);
    expect(error.name).toBe("AuthorizationError");
  });

  it("should create an AuthorizationError with details", () => {
    const error = new AuthorizationError("Forbidden", {
      requiredRole: "admin",
    });

    expect(error.details).toEqual({ requiredRole: "admin" });
  });
});

describe("ConflictError", () => {
  it("should create a ConflictError", () => {
    const error = new ConflictError("Resource already exists");

    expect(error).toBeInstanceOf(StandardError);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe("Resource already exists");
    expect(error.code).toBe("CONFLICT");
    expect(error.statusCode).toBe(409);
    expect(error.name).toBe("ConflictError");
  });

  it("should create a ConflictError with details", () => {
    const error = new ConflictError("Resource already exists", {
      id: "123",
    });

    expect(error.details).toEqual({ id: "123" });
  });
});

describe("DatabaseError", () => {
  it("should create a DatabaseError", () => {
    const error = new DatabaseError("Connection failed");

    expect(error).toBeInstanceOf(StandardError);
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.message).toBe("Connection failed");
    expect(error.code).toBe("DATABASE_ERROR");
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe("DatabaseError");
  });

  it("should create a DatabaseError with details", () => {
    const error = new DatabaseError("Query failed", {
      query: "SELECT * FROM users",
    });

    expect(error.details).toEqual({ query: "SELECT * FROM users" });
  });
});

describe("Factory Functions", () => {
  describe("createNotFoundError", () => {
    it("should create a NotFoundError with formatted message", () => {
      const error = createNotFoundError("User", "123");

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.message).toBe("User with id '123' not found");
      expect(error.code).toBe("NOT_FOUND");
      expect(error.statusCode).toBe(404);
    });
  });

  describe("createValidationError", () => {
    it("should create a ValidationError with field", () => {
      const error = createValidationError("email", "Email is required");

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toBe("Email is required");
      expect(error.field).toBe("email");
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
    });
  });

  describe("createAuthError", () => {
    it("should create an AuthenticationError with default message", () => {
      const error = createAuthError();

      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.message).toBe("Authentication required");
      expect(error.code).toBe("AUTHENTICATION_ERROR");
      expect(error.statusCode).toBe(401);
    });

    it("should create an AuthenticationError with custom message", () => {
      const error = createAuthError("Invalid token");

      expect(error.message).toBe("Invalid token");
    });
  });

  describe("createForbiddenError", () => {
    it("should create an AuthorizationError with default message", () => {
      const error = createForbiddenError();

      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error.message).toBe("Forbidden");
      expect(error.code).toBe("AUTHORIZATION_ERROR");
      expect(error.statusCode).toBe(403);
    });

    it("should create an AuthorizationError with custom message", () => {
      const error = createForbiddenError("Admin access required");

      expect(error.message).toBe("Admin access required");
    });
  });

  describe("createConflictError", () => {
    it("should create a ConflictError with formatted message", () => {
      const error = createConflictError("User", "john@example.com");

      expect(error).toBeInstanceOf(ConflictError);
      expect(error.message).toBe("User 'john@example.com' already exists");
      expect(error.code).toBe("CONFLICT");
      expect(error.statusCode).toBe(409);
    });
  });

  describe("createDatabaseError", () => {
    it("should create a DatabaseError with formatted message", () => {
      const error = createDatabaseError("SELECT");

      expect(error).toBeInstanceOf(DatabaseError);
      expect(error.message).toBe("Database operation failed: SELECT");
      expect(error.code).toBe("DATABASE_ERROR");
      expect(error.statusCode).toBe(500);
    });

    it("should create a DatabaseError with details", () => {
      const error = createDatabaseError("INSERT", { table: "users" });

      expect(error.message).toBe("Database operation failed: INSERT");
      expect(error.details).toEqual({ table: "users" });
    });
  });
});

describe("errorToHTTPStatus", () => {
  it("should return correct status for StandardError", () => {
    const error = new NotFoundError("Not found");
    expect(errorToHTTPStatus(error)).toBe(404);
  });

  it("should return 500 for non-StandardError", () => {
    const error = new Error("Generic error");
    expect(errorToHTTPStatus(error)).toBe(500);
  });

  it("should return correct status for all error types", () => {
    expect(errorToHTTPStatus(new NotFoundError("test"))).toBe(404);
    expect(errorToHTTPStatus(new ValidationError("test"))).toBe(400);
    expect(errorToHTTPStatus(new AuthenticationError("test"))).toBe(401);
    expect(errorToHTTPStatus(new AuthorizationError("test"))).toBe(403);
    expect(errorToHTTPStatus(new ConflictError("test"))).toBe(409);
    expect(errorToHTTPStatus(new DatabaseError("test"))).toBe(500);
  });
});

describe("errorToResponse", () => {
  it("should convert StandardError to response", () => {
    const error = new NotFoundError("User not found");
    const response = errorToResponse(
      error,
      "req-123",
      "/api/users/123",
      "GET"
    );

    expect(response.error).toBe(true);
    expect(response.code).toBe("NOT_FOUND");
    expect(response.message).toBe("User not found");
    expect(response.statusCode).toBe(404);
    expect(response.requestId).toBe("req-123");
    expect(response.path).toBe("/api/users/123");
    expect(response.method).toBe("GET");
    expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(response.stack).toBeUndefined();
    expect(response.details).toBeUndefined();
    expect(response.field).toBeUndefined();
  });

  it("should include stack trace when includeStack is true", () => {
    const error = new NotFoundError("User not found");
    const response = errorToResponse(
      error,
      "req-123",
      "/api/users/123",
      "GET",
      true
    );

    expect(response.stack).toBeDefined();
    expect(response.stack).toContain("NotFoundError");
  });

  it("should include details when includeDetails is true", () => {
    const error = new NotFoundError("User not found", { id: "123" });
    const response = errorToResponse(
      error,
      "req-123",
      "/api/users/123",
      "GET",
      false,
      true
    );

    expect(response.details).toEqual({ id: "123" });
  });

  it("should include field for ValidationError", () => {
    const error = new ValidationError("Email is invalid", "email");
    const response = errorToResponse(
      error,
      "req-123",
      "/api/users",
      "POST"
    );

    expect(response.field).toBe("email");
  });

  it("should convert generic Error to response", () => {
    const error = new Error("Unexpected error");
    const response = errorToResponse(
      error,
      "req-123",
      "/api/users",
      "POST"
    );

    expect(response.error).toBe(true);
    expect(response.code).toBe("INTERNAL_ERROR");
    expect(response.message).toBe("Unexpected error");
    expect(response.statusCode).toBe(500);
    expect(response.requestId).toBe("req-123");
    expect(response.path).toBe("/api/users");
    expect(response.method).toBe("POST");
  });

  it("should handle error without message", () => {
    const error = new Error();
    const response = errorToResponse(
      error,
      "req-123",
      "/api/test",
      "GET"
    );

    expect(response.message).toBe("An unexpected error occurred");
  });

  it("should include both stack and details when both flags are true", () => {
    const error = new ValidationError("Invalid email", "email", {
      pattern: "email",
    });
    const response = errorToResponse(
      error,
      "req-123",
      "/api/users",
      "POST",
      true,
      true
    );

    expect(response.stack).toBeDefined();
    expect(response.details).toEqual({ pattern: "email" });
    expect(response.field).toBe("email");
  });
});
