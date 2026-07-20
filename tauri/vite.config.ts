/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  optimizeDeps: {
    entries: [resolve(__dirname, "index.html"), resolve(__dirname, "quick-search.html"), resolve(__dirname, "preferences.html")],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        quickSearch: resolve(__dirname, "quick-search.html"),
        preferences: resolve(__dirname, "preferences.html"),
      },
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          markdown: ["react-markdown", "remark-gfm", "remark-math", "rehype-katex", "katex"],
          codemirror: ["@codemirror/view", "@codemirror/state", "@codemirror/lang-markdown"],
          d3: ["d3"],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    // *.ollama.test.ts requires a live Ollama instance and is run separately
    // via `npm run test:ollama` (see vitest.ollama.config.ts) so the default
    // suite stays fast and offline.
    include: ["src/tests/**/*.test.ts", "src/tests/**/*.test.tsx"],
    exclude: ["src/tests/**/*.ollama.test.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 1,
        execArgv: ["--max-old-space-size=4096"],
      },
    },
    coverage: {
      provider: "v8",
      include: ["src/stores/**", "src/hooks/**", "src/lib/platform.ts"],
    },
  },
}));
