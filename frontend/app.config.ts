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
    // BUMP THIS on every dev build you intend to install over an existing one.
    // Android silently refuses to replace an installed app with an equal or
    // lower versionCode — the install appears to succeed and the old APK keeps
    // running, which is indistinguishable from "the fix didn't work". All three
    // builds before this one were versionCode 1, which is exactly what happened.
    // (eas.json `autoIncrement` would automate this, but it requires EAS remote
    // versioning and is rejected outright with a dynamic app.config.ts.)
    versionCode: 2,
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
