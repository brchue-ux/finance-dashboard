import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    // Pure, React-Native-free logic only. There is no Metro transform or RN
    // preset here on purpose: a module that imports react-native can't be
    // tested by this config, which is exactly why `lib/csv-signs.ts` was
    // written RN-free — see its docstring.
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    // Mirrors tsconfig's "@/*" -> frontend root, so tests import modules the
    // same way the app does.
    alias: { "@": resolve(__dirname, ".") },
  },
});
