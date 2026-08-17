/**
 * Guards a drift that shipped since the initial commit: `backend/package.json`'s
 * `dev`/`start` scripts and both `.env.example` files carried a stale `3001`
 * (a vestige of the abandoned Railway deploy) while the real convention —
 * documented, deployed, and what the frontend's runtime config defaults to —
 * is `3011`. On this host 3001 is held by an unrelated service, so a fresh
 * clone following the committed defaults reaches a live HTTP server that is
 * NOT this backend, rather than a connection refused.
 *
 * Every value is PARSED from the committed files rather than hardcoded —
 * hardcoding the expected port here would just move the duplication, and a
 * future rename to yet another port should only require updating one place.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function scriptPort(pkg: { scripts?: Record<string, string> }, scriptName: string): number {
  const cmd = pkg.scripts?.[scriptName];
  expect(cmd, `backend/package.json has no "${scriptName}" script`).toBeDefined();
  const match = cmd!.match(/--port[= ](\d+)/);
  expect(match, `backend/package.json's "${scriptName}" script has no explicit --port`).not.toBeNull();
  return Number(match![1]);
}

function envExamplePort(relativePath: string, key: string): number {
  const contents = readFile(relativePath);
  const line = contents.split("\n").find((l) => l.startsWith(`${key}=`));
  expect(line, `${relativePath} has no ${key} line`).toBeDefined();
  const match = line!.match(/:(\d+)(?:\/|$)/);
  expect(match, `${relativePath}'s ${key} has no explicit port`).not.toBeNull();
  return Number(match![1]);
}

describe("backend dev port", () => {
  it("agrees across package.json scripts and both .env.example files", () => {
    const pkg = JSON.parse(readFile("../package.json")) as { scripts?: Record<string, string> };
    const ports = {
      "backend/package.json dev": scriptPort(pkg, "dev"),
      "backend/package.json start": scriptPort(pkg, "start"),
      "backend/.env.example BETTER_AUTH_URL": envExamplePort("../.env.example", "BETTER_AUTH_URL"),
      "frontend/.env.example EXPO_PUBLIC_API_URL": envExamplePort(
        "../../frontend/.env.example",
        "EXPO_PUBLIC_API_URL",
      ),
    };

    const distinctPorts = new Set(Object.values(ports));
    expect(
      distinctPorts.size,
      `committed port defaults disagree: ${JSON.stringify(ports)}`,
    ).toBe(1);
  });
});
