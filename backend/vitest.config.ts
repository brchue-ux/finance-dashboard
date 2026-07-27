import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    // Some pure helpers live in modules that also import db/index.ts, which
    // builds a libsql client at import time. An in-memory URL satisfies that
    // without any test touching a real database — no test here issues a query.
    // (The coupling is a design smell worth unpicking later; this keeps the
    // suite honest without refactoring working code to make it testable.)
    env: { DATABASE_URL: "file::memory:" },
    // Pure logic plus route handlers, which are imported directly with their
    // collaborators stubbed (see AGENTS.md). Nothing here opens a real DB,
    // Plaid, or Anthropic connection — those paths are exercised through
    // injectable seams, or verified against the running server instead.
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
  resolve: {
    // Mirrors tsconfig's "@/*" -> backend root, so tests import modules the
    // same way the app does.
    alias: { "@": resolve(__dirname, ".") },
  },
});
