import Constants from "expo-constants";

const API_URL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "http://localhost:3001";

export function getApiUrl() {
  return API_URL;
}
