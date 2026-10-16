import { AppError } from './errors.js';

interface ValidationResult {
  success: boolean;
  error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
}

/**
 * Hook passed to zValidator(...) so invalid input produces our standard error:
 *   { error: { code: "VALIDATION_ERROR", message: "...", details: [...] } }
 */
export function onInvalid(result: ValidationResult): void {
  if (result.success || !result.error) return;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  const first = issues[0];
  const message = first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Invalid input';
  throw new AppError(400, 'VALIDATION_ERROR', message, issues);
}
