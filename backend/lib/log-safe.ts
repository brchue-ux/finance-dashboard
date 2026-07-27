/**
 * Sanitizer for untrusted values that are written to the server log.
 *
 * Log output is a text sink of its own: a value carrying CR/LF can forge whole
 * log lines, and an unbounded one can flood the log. Values that reach here are
 * attacker-controllable query parameters, so both are bounded before the value
 * is interpolated. This is for logs ONLY — never for a response body, where
 * `escapeHtml` in `close-page.ts` is the right tool.
 */
const MAX_LOGGED_LENGTH = 200;

export function sanitizeForLog(value: string, maxLength = MAX_LOGGED_LENGTH): string {
  const flattened = value.replace(/[\r\n]+/g, " ");
  return flattened.length > maxLength ? `${flattened.slice(0, maxLength)}…` : flattened;
}
