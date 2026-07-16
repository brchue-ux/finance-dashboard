import { createAuthClient } from "better-auth/react";
import { getApiUrl, setSessionToken, clearSessionToken } from "./api";

export const authClient = createAuthClient({
  baseURL: getApiUrl(),
});

export async function signIn(email: string, password: string) {
  const result = await authClient.signIn.email({ email, password });
  if (result.data?.session?.token) {
    await setSessionToken(result.data.session.token);
  }
  return result;
}

export async function signOut() {
  await authClient.signOut();
  await clearSessionToken();
}
