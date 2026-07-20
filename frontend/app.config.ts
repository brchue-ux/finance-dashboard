import { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Finance Dashboard",
  slug: "finance-dashboard",
  owner: "brchue",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#13111C",
  },
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.brchue.financedashboard",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#13111C",
    },
    package: "com.brchue.financedashboard",
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/favicon.png",
  },
  plugins: ["expo-router", "expo-secure-store", "expo-web-browser"],
  scheme: "finance-dashboard",
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001",
    eas: {
      projectId: "99316aa0-a650-4013-bc02-75ccfdfe8b0a",
    },
  },
};

export default config;
