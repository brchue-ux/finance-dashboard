import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API-only backend — no frontend pages
  // Runs as persistent Node.js on Railway (not serverless)
  output: "standalone",
  // Pin the standalone output layout to the monorepo root. Next otherwise infers
  // the tracing root from the OUTERMOST lockfile it can find, so an unrelated
  // stray package-lock.json in a PARENT of the repo silently moves the artifact
  // from .next/standalone/backend/ to .next/standalone/<repo-dir>/backend/ — the
  // deployed systemd unit then starts nothing. Anchoring to __dirname makes the
  // path depend only on the repo, not on whatever sits above the checkout.
  outputFileTracingRoot: path.join(__dirname, ".."),
  // Keep Better Auth + Drizzle out of the webpack bundle so they load as CJS
  // at runtime. Bundling better-auth's drizzle adapter mangles drizzle-orm's
  // named exports (`(0, drizzle_orm.eq) is not a function`), breaking sign-in.
  serverExternalPackages: [
    "better-auth",
    "@better-auth/expo",
    "@better-auth/drizzle-adapter",
    "drizzle-orm",
  ],
};

export default nextConfig;
