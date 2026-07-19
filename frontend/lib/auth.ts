import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { getApiUrl } from "./env";

// The expo plugin needs a synchronous { getItem, setItem } store. On native
// that's SecureStore. On web, expo-secure-store's module is a throwing stub
// (its web build is `export default {}`), so we back the plugin with
// localStorage instead. On web the real session cookie is HttpOnly and owned
// by the browser's own jar — the plugin's store never actually holds it there,
// but it must not throw, and the cookie round-trip happens via the browser
// with credentials:"include" (see lib/api.ts + better-auth's client default).
const storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } =
  Platform.OS === "web"
    ? {
        getItem: (key) =>
          typeof localStorage !== "undefined" ? localStorage.getItem(key) : null,
        setItem: (key, value) => {
          if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
        },
      }
    : SecureStore;

// scheme must match app.config.ts's `scheme` and the backend's
// trustedOrigins ("finance-dashboard://") -- see backend/lib/auth.ts.
export const authClient = createAuthClient({
  baseURL: getApiUrl(),
  plugins: [
    expoClient({
      scheme: "finance-dashboard",
      storagePrefix: "finance-dashboard",
      storage,
    }),
  ],
});

export const { signOut, useSession } = authClient;

export async function signIn(email: string, password: string) {
  const { error } = await authClient.signIn.email({ email, password });
  if (error) throw new Error(error.message ?? "Sign in failed");
}
