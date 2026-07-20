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
  const cookie = Platform.OS === "web" ? null : authClient.getCookie();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(cookie ? { Cookie: cookie } : {}),
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });

  if (res.status === 401) {
    await authClient.signOut();
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
