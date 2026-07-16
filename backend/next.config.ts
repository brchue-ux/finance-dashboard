import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API-only backend — no frontend pages
  // Runs as persistent Node.js on Railway (not serverless)
  output: "standalone",
};

export default nextConfig;
