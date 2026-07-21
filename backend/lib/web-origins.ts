/**
 * The single list of browser origins this backend trusts.
 *
 * Two layers consume it and they must agree, or the failure is baffling: CORS
 * (middleware.ts) decides whether the browser is allowed to read the response,
 * while Better Auth's `trustedOrigins` decides whether the request is answered
 * at all. A CORS preflight passing therefore proves nothing about auth —
 * observed live as an Expo web sign-in POST getting 403 from Better Auth while
 * the OPTIONS preflight returned a clean 204.
 *
 * Native is unaffected by both: React Native's fetch sends no Origin header, so
 * neither check applies — which is exactly why device testing can never surface
 * a web-origin problem.
 */

/** Local Expo web dev servers. Never trusted in production. */
const DEV_ORIGINS = [
  "http://localhost:8081", // expo start (web)
  "http://localhost:19006", // legacy expo web port
];

export function webOrigins(): string[] {
  // Deployed origins (Vercel production + preview URLs), comma-separated.
  const configured = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  // Gate the localhost entries on environment: trusting them in production
  // would widen CSRF protection for origins that only ever exist on a
  // developer's machine.
  const dev = process.env.NODE_ENV === "production" ? [] : DEV_ORIGINS;

  return Array.from(new Set([...dev, ...configured]));
}
