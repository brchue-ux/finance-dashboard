/**
 * API client — thin wrapper around fetch pointing at the Railway backend.
 * Session state lives in the better-auth expo client's SecureStore-backed
 * cookie jar (see lib/auth.ts); this file just rides on it for routes that
 * aren't better-auth endpoints themselves.
 */
import { Platform } from "react-native";
import { getApiUrl } from "./env";
import { authClient } from "./auth";

const API_URL = getApiUrl();

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  // Native RN has no cookie jar, so we replay the plugin-stored cookie as a
  // header. On web the browser owns the (HttpOnly) cookie and forbids setting
  // the Cookie header from JS — credentials:"include" attaches it instead.
  const isWeb = Platform.OS === "web";

  async function send(): Promise<Response> {
    const cookie = isWeb ? null : authClient.getCookie();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers as Record<string, string>),
    };
    return fetch(`${API_URL}${path}`, {
      ...options,
      // Native: "omit". React Native's fetch is backed by a native cookie jar
      // (OkHttp on Android), and with "include" that jar takes precedence over
      // a manually-set Cookie header. Any endpoint that sets an unrelated
      // cookie therefore hijacks every later request: hitting
      // /api/import/excel/start put `ms_oauth_state` in the jar, and from then
      // on requests carried ONLY that cookie instead of the session token —
      // observed live as `cookies=ms_oauth_state len=51`. The session lives in
      // SecureStore and is replayed as a header, so the jar must stay out of it.
      // Web keeps "include": the cookie is HttpOnly and owned by the browser.
      credentials: isWeb ? "include" : "omit",
      headers,
    });
  }

  let res = await send();

  if (res.status === 401) {
    // Retry once with a freshly read cookie. A 401 alone is not proof the
    // session is gone — it is also what a transient cookie read produces.
    res = await send();
  }

  if (res.status === 401) {
    // Only now decide it is real, and only sign out if the session is
    // genuinely invalid. Previously ANY 401 from ANY endpoint called
    // signOut(), so an expected 401 from an unconfigured integration
    // (/api/import/google/start) logged the user out of the whole app.
    const { data } = await authClient.getSession();
    if (!data?.session) await authClient.signOut();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
