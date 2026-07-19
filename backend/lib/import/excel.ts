/**
 * Excel live-import helper (spec §5.7 / Tickets 008/004) — Microsoft Graph
 * workbook reads over delegated OAuth (Microsoft identity platform).
 *
 * Token handling uses MSAL's own serializable token cache rather than
 * hand-managing refresh tokens: the whole cache blob is AES-encrypted into
 * spreadsheet_connections.accessToken, and acquireTokenSilent() does refresh +
 * rotation. This is MSAL's sanctioned persistence pattern — more reliable than
 * extracting the refresh token out of MSAL's internal cache format ourselves.
 */
import { ConfidentialClientApplication, type ICachePlugin, type TokenCacheContext } from "@azure/msal-node";
import { db } from "@/db";
import { spreadsheetConnections } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto";
import { v4 as uuidv4 } from "uuid";

const PROVIDER = "excel";
// offline_access → refresh token; Files.Read → workbook reads. openid/profile implicit.
const SCOPES = ["Files.Read", "offline_access"];

function redirectUri(): string {
  return `${process.env.APP_BASE_URL ?? "http://localhost:3011"}/api/import/excel/callback`;
}

function baseConfig() {
  return {
    clientId: process.env.MS_OAUTH_CLIENT_ID ?? "",
    clientSecret: process.env.MS_OAUTH_CLIENT_SECRET ?? "",
    authority: `https://login.microsoftonline.com/${process.env.MS_OAUTH_TENANT ?? "common"}`,
  };
}

export function excelConfigured(): boolean {
  return Boolean(process.env.MS_OAUTH_CLIENT_ID && process.env.MS_OAUTH_CLIENT_SECRET);
}

/**
 * A cache plugin bound to one connection row: loads the stored blob before use,
 * writes it back (encrypted) whenever MSAL rotates tokens. `onBlob` lets the
 * caller capture the freshest blob (used at first-connect, before a row exists).
 */
function boundCachePlugin(opts: {
  initialBlob?: string;
  connectionId?: string;
  onBlob?: (blob: string) => void;
}): ICachePlugin {
  return {
    beforeCacheAccess: async (ctx: TokenCacheContext) => {
      if (opts.initialBlob) ctx.tokenCache.deserialize(opts.initialBlob);
    },
    afterCacheAccess: async (ctx: TokenCacheContext) => {
      if (!ctx.cacheHasChanged) return;
      const blob = ctx.tokenCache.serialize();
      opts.onBlob?.(blob);
      if (opts.connectionId) {
        await db
          .update(spreadsheetConnections)
          .set({ accessToken: encrypt(blob) })
          .where(eq(spreadsheetConnections.id, opts.connectionId));
      }
    },
  };
}

export function excelConsentUrl(state: string): Promise<string> {
  const cca = new ConfidentialClientApplication({ auth: baseConfig() });
  return cca.getAuthCodeUrl({ scopes: SCOPES, redirectUri: redirectUri(), state });
}

/** Exchange the callback code, then persist MSAL's token cache for the user. */
export async function exchangeExcelCode(userId: string, code: string): Promise<string> {
  let blob = "";
  const cca = new ConfidentialClientApplication({
    auth: baseConfig(),
    cache: { cachePlugin: boundCachePlugin({ onBlob: (b) => (blob = b) }) },
  });
  await cca.acquireTokenByCode({ code, scopes: SCOPES, redirectUri: redirectUri() });
  if (!blob) blob = cca.getTokenCache().serialize();

  const now = Math.floor(Date.now() / 1000);
  const [existing] = await db
    .select({ id: spreadsheetConnections.id })
    .from(spreadsheetConnections)
    .where(and(eq(spreadsheetConnections.userId, userId), eq(spreadsheetConnections.provider, PROVIDER)))
    .limit(1);

  if (existing) {
    await db
      .update(spreadsheetConnections)
      .set({ accessToken: encrypt(blob), status: "active" })
      .where(eq(spreadsheetConnections.id, existing.id));
    return existing.id;
  }

  const id = uuidv4();
  await db.insert(spreadsheetConnections).values({
    id,
    userId,
    provider: PROVIDER,
    accessToken: encrypt(blob), // MSAL serialized token cache, not a bare token
    status: "active",
    createdAt: now,
  });
  return id;
}

export type ExcelConnection = typeof spreadsheetConnections.$inferSelect;

/** A valid Graph access token for the user (silent refresh), or null if unconnected. */
export async function excelAccessTokenForUser(
  userId: string
): Promise<{ accessToken: string; connection: ExcelConnection } | null> {
  const [conn] = await db
    .select()
    .from(spreadsheetConnections)
    .where(and(eq(spreadsheetConnections.userId, userId), eq(spreadsheetConnections.provider, PROVIDER)))
    .limit(1);
  if (!conn) return null;

  const cca = new ConfidentialClientApplication({
    auth: baseConfig(),
    cache: { cachePlugin: boundCachePlugin({ initialBlob: decrypt(conn.accessToken), connectionId: conn.id }) },
  });

  const accounts = await cca.getTokenCache().getAllAccounts();
  if (accounts.length === 0) return null; // grant lost — caller flags reauth
  const result = await cca.acquireTokenSilent({ account: accounts[0], scopes: SCOPES });
  return { accessToken: result.accessToken, connection: conn };
}

/**
 * Read a worksheet's used range from a OneDrive-hosted workbook via Graph.
 * `filePath` is the path under the user's drive root, e.g. "Documents/budget.xlsx".
 * Cells are coerced to strings so the shared normalizer sees a uniform grid.
 */
export async function readExcelUsedRange(
  accessToken: string,
  filePath: string,
  worksheet: string
): Promise<string[][]> {
  const path = filePath.replace(/^\/+/, "");
  const url =
    `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURI(path)}:` +
    `/workbook/worksheets('${encodeURIComponent(worksheet)}')/usedRange?$select=values`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Graph ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { values?: unknown[][] };
  return (data.values ?? []).map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
}
