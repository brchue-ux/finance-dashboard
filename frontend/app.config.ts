import { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Finance Dashboard",
  slug: "finance-dashboard",
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
    bundleIdentifier: "com.yourname.financedashboard",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#13111C",
    },
    package: "com.yourname.financedashboard",
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/favicon.png",
  },
  plugins: ["expo-router", "expo-secure-store"],
  scheme: "finance-dashboard",
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001",
    eas: {
      projectId: "your-eas-project-id", // set after running: eas init
    },
  },
};

export default config;
