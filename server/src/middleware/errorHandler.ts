import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError } from '../lib/errors.js';

function body(code: string, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Converts every thrown error into the standard JSON error response. */
export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json(body(err.code, err.message, err.details), err.status);
  }

  if (err instanceof HTTPException) {
    const status = err.status as ContentfulStatusCode;
    if (status === 413) {
      return c.json(body('FILE_TOO_LARGE', 'The upload is larger than the allowed size'), 413);
    }
    if (status === 403) {
      return c.json(body('FORBIDDEN', 'Request blocked (cross-site request)'), 403);
    }
    return c.json(body('HTTP_ERROR', err.message || 'Request failed'), status);
  }

  // Unexpected error: log details on the server, but never leak them to the client.
  console.error('Unhandled error:', err);
  return c.json(body('INTERNAL_ERROR', 'Something went wrong. Please try again.'), 500);
};

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json(body('NOT_FOUND', `Route ${c.req.method} ${c.req.path} not found`), 404);
