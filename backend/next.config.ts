import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API-only backend — no frontend pages
  // Runs as persistent Node.js on Railway (not serverless)
  output: "standalone",
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
