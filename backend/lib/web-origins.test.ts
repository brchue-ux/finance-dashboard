/**
 * Guards the disagreement that made the Expo web target unusable: `DEV_ORIGINS`
 * trusted :8081/:19006 while `frontend/package.json`'s start script binds Metro
 * to :8082, so every web sign-in came back 403 INVALID_ORIGIN. Native never
 * surfaces it (React Native sends no Origin header), and a CORS preflight
 * passes regardless, so nothing else in the suite can catch the drift.
 *
 * The port is PARSED from package.json rather than hardcoded — hardcoding it
 * here would just move the same duplication one file over.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { webOrigins } from "./web-origins";

/** The port `npm start --workspace=frontend` actually binds Metro to. */
function metroStartPort(): number {
  const path = fileURLToPath(new URL("../../frontend/package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(path, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const start = pkg.scripts?.start ?? "";
  // `expo start --port 8082` — also tolerate `--port=8082`.
  const match = start.match(/--port[= ](\d+)/);
  // Fall back to Metro's own default only when the script names no port; a
  // script that stops passing --port is a real change, not a test failure.
  return match ? Number(match[1]) : 8081;
}

describe("webOrigins", () => {
  it("trusts the port frontend/package.json's start script binds Metro to", () => {
    expect(webOrigins()).toContain(`http://localhost:${metroStartPort()}`);
  });

  it("parses a real port out of the start script", () => {
    // Keeps the assertion above from passing vacuously if the script is
    // rewritten into a form the regex no longer understands.
    const port = metroStartPort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
  });

  it("drops every localhost origin in production", () => {
    const previous = process.env.NODE_ENV;
    // webOrigins() also appends CORS_ALLOWED_ORIGINS; a shell or CI job that
    // exports it would otherwise make this exact-empty assertion fail.
    const previousAllowed = process.env.CORS_ALLOWED_ORIGINS;
    try {
      // NODE_ENV is readonly in @types/node's ProcessEnv; assign through the bag.
      (process.env as Record<string, string>).NODE_ENV = "production";
      delete process.env.CORS_ALLOWED_ORIGINS;
      expect(webOrigins()).toEqual([]);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = previous ?? "test";
      if (previousAllowed === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
      else process.env.CORS_ALLOWED_ORIGINS = previousAllowed;
    }
  });

  it("appends the configured deployed origins", () => {
    const previous = process.env.CORS_ALLOWED_ORIGINS;
    try {
      process.env.CORS_ALLOWED_ORIGINS = "https://a.example , https://b.example";
      const origins = webOrigins();
      expect(origins).toContain("https://a.example");
      expect(origins).toContain("https://b.example");
    } finally {
      if (previous === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
      else process.env.CORS_ALLOWED_ORIGINS = previous;
    }
  });
});
