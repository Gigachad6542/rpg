import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          if (id.includes("node_modules/@tauri-apps")) return "tauri";
          return undefined;
        },
      },
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "app",
          exclude: [...configDefaults.exclude, "tests/e2e/**", "tests/evals/**"],
        },
      },
      {
        test: {
          name: "evals",
          include: ["tests/evals/**/*.test.ts"],
          environment: "node",
          globals: true,
        },
      },
    ],
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    environment: "jsdom",
    globals: true,
    setupFiles: "./tests/setup.ts",
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/**/*.d.ts",
        "src/**/index.ts",
        "src/db/types.ts",
        "src/domain/ids.ts",
        "src/providers/ImageModelAdapter.ts",
        "src/providers/TextModelAdapter.ts",
      ],
      thresholds: {
        statements: 72,
        branches: 72,
        functions: 72,
        lines: 72,
      },
    },
  },
});
