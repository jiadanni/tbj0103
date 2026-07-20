/// <reference types="vitest" />
import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Tests that require a real, running Ollama instance (http://localhost:11434
// with a model pulled). Kept out of the default `npm run test` suite so CI
// and pre-commit checks stay fast and offline — run explicitly with
// `npm run test:ollama` against a live `ollama serve`.
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/tests/**/*.ollama.test.ts"],
    testTimeout: 30_000,
  },
});
