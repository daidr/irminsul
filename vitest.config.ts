import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const appDir = fileURLToPath(new URL("./app", import.meta.url));

export default defineConfig({
  // Mirror Nuxt 4 path aliases so runtime imports (e.g. `~~/shared/...`) resolve under Vitest.
  resolve: {
    alias: {
      "~~": rootDir,
      "@@": rootDir,
      "~": appDir,
      "@": appDir,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    unstubGlobals: true,
  },
});
