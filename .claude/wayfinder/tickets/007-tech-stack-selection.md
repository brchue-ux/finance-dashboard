---
label: wayfinder:grilling
status: closed
assignee:
parent: map
blocks: [009]
blocked-by: [003]
---

# Which tech stack should the app be built on?

## Decision: Separated backend (Next.js API) + frontend (Expo React Native)

## Decisions

1. **Architecture:** Backend and frontend separated from day one — not a monolithic Next.js app.

2. **Backend:** Next.js API routes — handles all integrations (bank aggregator, Wealthsimple, Google Sheets), auth, database, and LLM engine. Deployed on Railway as a persistent Node.js process.

3. **Frontend:** Expo (React Native) — one codebase compiling to web (Vercel), Android APK (sideloadable via EAS Build), and Play Store ready if commercial distribution ever becomes a goal.

4. **Mobile distribution:** Expo EAS Build generates the Android APK for sideloading today. Play Store submission is available without a rewrite. No Capacitor needed.

5. **Auth:** Better Auth — self-hosted, Expo-compatible, full token control. User accounts, sessions, and all third-party tokens (bank, Wealthsimple, Google) live in the app's own database. No third party holds user identity or credentials.

6. **Database:** Turso (SQLite) + Drizzle ORM — free tier, zero cold start, TypeScript-first. Migration path to Neon (Postgres) is straightforward via Drizzle if write concurrency or query complexity demands it at scale.

7. **Deployment:**
   - Backend: Railway ($5/month) — persistent process, no LLM streaming timeout, native cron jobs
   - Frontend web: Vercel (free tier) — static Expo web build
   - Mobile: Expo EAS Build (free tier) — APK generation and sideloading
   - Scale path: each layer upgrades independently

8. **LLM integration:** Vercel AI SDK (`streamText`, tool use) — model-agnostic abstraction over Anthropic SDK. Enables LLM provider switching at scale without rewriting the advisory engine.

9. **Real-time updates:** TanStack Query with `refetchInterval` polling — simplest approach, no WebSocket infrastructure needed.

10. **Scheduled jobs:** Railway cron — background bank sync, portfolio refresh.

11. **UI components:** NativeWind (Tailwind for React Native) — replaces shadcn/ui, consistent styling across web and mobile from one utility class system.

## Scale path summary
- Backend: Railway → larger instance → AWS/GCP/Azure (standard Node.js, moves anywhere)
- Database: Turso → Neon (change connection string + Drizzle dialect)
- Auth: Better Auth self-hosted, moves with backend, no vendor constraint
- Frontend: Vercel auto-scales static hosting; Expo handles multi-platform from day one
