const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

// Monorepo (npm workspaces): watch the repo root and let Metro resolve modules
// from both the app's own node_modules and the hoisted root node_modules, so a
// single copy of react / react-native is used across the workspace.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);
// Extend Expo's default watchFolders (root node_modules + each workspace) with
// the monorepo root, rather than replacing them — replacing drops entries Expo
// relies on and trips expo-doctor's Metro-config check.
config.watchFolders = [...config.watchFolders, workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = withNativeWind(config, { input: "./global.css" });
