/**
 * API client — thin wrapper around fetch pointing at the Railway backend.
 * Session token is stored in Expo SecureStore and sent as a Bearer header.
 */
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

const API_URL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "http://localhost:3001";

const SESSION_KEY = "session_token";

export function getApiUrl() {
  return API_URL;
}

export async function getSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEY);
}

export async function setSessionToken(token: string) {
  await SecureStore.setItemAsync(SESSION_KEY, token);
}

export async function clearSessionToken() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getSessionToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    await clearSessionToken();
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
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
};
