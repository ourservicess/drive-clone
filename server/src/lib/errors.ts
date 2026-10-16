import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Throw an AppError anywhere in a route or service. The global error handler
 * turns it into the standard JSON shape:
 *   { "error": { "code": "NOT_FOUND", "message": "File not found" } }
 */
export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Please log in to continue') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
