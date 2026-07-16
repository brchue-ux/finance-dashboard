import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
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
    // Better Auth stores sessions in Turso; Expo SecureStore holds the token client-side
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
  },
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
});

export type Session = typeof auth.$Infer.Session;
