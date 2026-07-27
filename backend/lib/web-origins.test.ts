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

/**
 * Every port a script in frontend/package.json binds Metro to, keyed by script
 * name. Any script that runs `expo start` counts: whichever one a developer
 * runs, that dev server's origin is the one the browser sends.
 *
 * Parsing FAILS LOUDLY. An earlier version fell back to Metro's default 8081
 * when the regex missed, which made the guard below pass precisely when the
 * script changed shape — a guard that survives its own parser breaking is worse
 * than no guard.
 */
function metroScriptPorts(): Map<string, number> {
  const path = fileURLToPath(new URL("../../frontend/package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(path, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = Object.entries(pkg.scripts ?? {}).filter(([, cmd]) =>
    /\bexpo\s+start\b/.test(cmd),
  );

  expect(scripts.length, "frontend/package.json has no `expo start` script").toBeGreaterThan(0);

  const ports = new Map<string, number>();
  for (const [name, cmd] of scripts) {
    // `expo start --port 8082` — also tolerate `--port=8082` and `-p 8082`.
    const match = cmd.match(/(?:--port|-p)[= ](\d+)/);
    expect(
      match,
      `frontend script "${name}" runs expo start without an explicit --port, so ` +
        `Metro picks a port no one trusts and web sign-in returns 403 INVALID_ORIGIN`,
    ).not.toBeNull();
    const port = Number(match![1]);
    expect(Number.isInteger(port) && port > 0, `script "${name}" names a bad port`).toBe(true);
    ports.set(name, port);
  }
  return ports;
}

describe("webOrigins", () => {
  it("trusts every port frontend/package.json binds Metro to", () => {
    const origins = webOrigins();
    for (const [name, port] of metroScriptPorts()) {
      expect(origins, `frontend script "${name}" binds :${port}, absent from DEV_ORIGINS`).toContain(
        `http://localhost:${port}`,
      );
    }
  });

  it("finds an explicit port on every expo start script", () => {
    // metroScriptPorts() throws if a script omits --port, so this both proves
    // the parser found real work to do and stops the assertion above from
    // passing vacuously over an empty set.
    const ports = metroScriptPorts();
    expect(ports.size).toBeGreaterThan(0);
    expect(ports.get("start")).toBeGreaterThan(0);
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
