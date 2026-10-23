import type { ErrorRequestHandler, RequestHandler } from 'express'
import type { Logger } from 'pino'
import type { ZodType } from 'zod'
import type { ApiErrorBody, ApiErrorCode, ValidationIssue } from '../shared/types.ts'

export class HttpError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details?: unknown

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function validationError(message: string, issues?: ValidationIssue[]): HttpError {
  return new HttpError(400, 'validation', message, issues ? { issues } : undefined)
}

export function unauthorized(message = 'Sign in to continue.', status = 401): HttpError {
  return new HttpError(status, 'unauthorized', message)
}

export function notFound(message = 'Not found.'): HttpError {
  return new HttpError(404, 'not_found', message)
}

/** `details` reaches the client body, e.g. `{ requires }`, `{ reasons }` or `{ code: 'stale-preview' }`. */
export function conflict(message: string, details?: unknown): HttpError {
  return new HttpError(409, 'conflict', message, details)
}

/** Validates `data` with `schema`; throws a `validation` HttpError listing every issue. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
  throw validationError('Some fields need attention.', issues)
}

function body(code: ApiErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } }
}

function bodyParserType(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'type' in error) {
    const type = error.type
    return typeof type === 'string' ? type : undefined
  }
  return undefined
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error)
      return
    }
    if (error instanceof HttpError) {
      res.status(error.status).json(body(error.code, error.message, error.details))
      return
    }
    const type = bodyParserType(error)
    if (type === 'entity.parse.failed') {
      res.status(400).json(body('validation', 'The request body is not valid JSON.'))
      return
    }
    if (type === 'entity.too.large') {
      res.status(413).json(body('validation', 'The request body is too large.'))
      return
    }
    logger.error({ err: error, requestId: req.id }, 'unhandled error')
    res.status(500).json(body('internal', 'Something went wrong on the server.'))
  }
}

/** Last route handler under /api: unknown paths answer with the JSON error shape. */
export const apiNotFound: RequestHandler = (req, res, next) => {
  if (!req.path.startsWith('/api')) {
    next()
    return
  }
  res.status(404).json(body('not_found', 'Not found.'))
}
