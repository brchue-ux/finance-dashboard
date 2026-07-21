import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { expo } from "@better-auth/expo";
import { webOrigins } from "@/lib/web-origins";
import { db } from "@/db";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    // Public sign-up gated by env var — false at launch
    disableSignUp: process.env.PUBLIC_SIGNUP_ENABLED !== "true",
  },
  session: {
    // Web: standard browser cookies. Native (Expo): the expo() plugin below
    // mimics cookie behavior via SecureStore, since RN has no cookie jar.
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
  },
  // finance-dashboard:// — must match frontend/app.config.ts's `scheme` and
  // the expoClient()'s `scheme` option. Lets the native OAuth-style redirect
  // (used to hand the session back to the app) be trusted by the server.
  // The native scheme plus every browser origin CORS already allows. Without
  // the web origins here, Better Auth rejects an Expo *web* sign-in with 403
  // before checking credentials — while CORS preflight passes, so the two
  // layers disagree and the failure looks like bad credentials. Native sends
  // no Origin header and is unaffected either way.
  trustedOrigins: ["finance-dashboard://", ...webOrigins()],
  plugins: [expo()],
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
});

export type Session = typeof auth.$Infer.Session;
