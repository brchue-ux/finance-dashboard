/**
 * Google Sheets live-import helper (spec §5.7 / Tickets 008/004).
 *
 * OAuth (authorization-code, offline) + Sheets API reads. Tokens are stored
 * AES-encrypted in spreadsheet_connections. Two known-bug guards from the
 * decision log are handled here, not left to chance:
 *  - googleapis auto-refresh only triggers when `expiry_date` is set on the
 *    credentials (googleapis/google-api-nodejs-client#2350) — we always set it.
 *  - refreshed tokens are persisted via the client's `tokens` event so a rotated
 *    access token (and, first time, the refresh token) survives process restarts.
 */
import { google } from "googleapis";
import { db } from "@/db";
import { spreadsheetConnections } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto";
import { v4 as uuidv4 } from "uuid";

const PROVIDER = "google_sheets";
// Minimal scope — read the sheets the user points us at, nothing else.
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// Derive the client type from googleapis' own OAuth2 ctor so it matches what
// google.sheets({ auth }) expects — importing OAuth2Client from
// google-auth-library directly clashes (two copies in the tree, distinct types).
type GoogleAuthClient = InstanceType<typeof google.auth.OAuth2>;

function redirectUri(): string {
  return `${process.env.APP_BASE_URL ?? "http://localhost:3011"}/api/import/google/callback`;
}

export function googleOAuthClient(): GoogleAuthClient {
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri()
  );
}

export function googleConsentUrl(state: string): string {
  return googleOAuthClient().generateAuthUrl({
    access_type: "offline", // request a refresh token
    prompt: "consent", // force refresh-token issuance even on re-auth
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

/** Exchange the callback code for tokens and upsert the user's connection. */
export async function exchangeGoogleCode(userId: string, code: string): Promise<string> {
  const client = googleOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error("Google returned no access token");

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null;

  const [existing] = await db
    .select({ id: spreadsheetConnections.id, refreshToken: spreadsheetConnections.refreshToken })
    .from(spreadsheetConnections)
    .where(and(eq(spreadsheetConnections.userId, userId), eq(spreadsheetConnections.provider, PROVIDER)))
    .limit(1);

  if (existing) {
    await db
      .update(spreadsheetConnections)
      .set({
        accessToken: encrypt(tokens.access_token),
        // Google only returns a refresh token on first consent — keep the old one otherwise
        ...(tokens.refresh_token ? { refreshToken: encrypt(tokens.refresh_token) } : {}),
        expiresAt,
        scope: tokens.scope ?? null,
        status: "active",
      })
      .where(eq(spreadsheetConnections.id, existing.id));
    return existing.id;
  }

  const id = uuidv4();
  await db.insert(spreadsheetConnections).values({
    id,
    userId,
    provider: PROVIDER,
    accessToken: encrypt(tokens.access_token),
    refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
    expiresAt,
    scope: tokens.scope ?? null,
    status: "active",
    createdAt: now,
  });
  return id;
}

export type GoogleConnection = typeof spreadsheetConnections.$inferSelect;

/**
 * An authorized OAuth2 client for the user, wired to persist any refreshed
 * token back to the DB. Returns null if the user hasn't connected Google.
 */
export async function googleClientForUser(
  userId: string
): Promise<{ client: GoogleAuthClient; connection: GoogleConnection } | null> {
  const [conn] = await db
    .select()
    .from(spreadsheetConnections)
    .where(and(eq(spreadsheetConnections.userId, userId), eq(spreadsheetConnections.provider, PROVIDER)))
    .limit(1);
  if (!conn) return null;

  const client = googleOAuthClient();
  client.setCredentials({
    access_token: decrypt(conn.accessToken),
    refresh_token: conn.refreshToken ? decrypt(conn.refreshToken) : undefined,
    // Required for auto-refresh to fire (the #2350 bug guard)
    expiry_date: conn.expiresAt ? conn.expiresAt * 1000 : undefined,
  });

  client.on("tokens", (t) => {
    const set: Partial<GoogleConnection> = {};
    if (t.access_token) set.accessToken = encrypt(t.access_token);
    if (t.refresh_token) set.refreshToken = encrypt(t.refresh_token);
    if (t.expiry_date) set.expiresAt = Math.floor(t.expiry_date / 1000);
    if (Object.keys(set).length === 0) return;
    // fire-and-forget; a failed persist just means we refresh again next call
    void db.update(spreadsheetConnections).set(set).where(eq(spreadsheetConnections.id, conn.id));
  });

  return { client, connection: conn };
}

/** Read a worksheet/A1 range as a raw string grid (header row + data rows). */
export async function readGoogleRange(
  client: GoogleAuthClient,
  spreadsheetId: string,
  range: string
): Promise<string[][]> {
  const sheets = google.sheets({ version: "v4", auth: client });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return (res.data.values as string[][] | undefined) ?? [];
}

/** Extract a spreadsheet ID from a full Sheets URL or accept a bare ID. */
export function parseSpreadsheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : input.trim();
}
