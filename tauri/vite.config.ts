import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  optimizeDeps: {
    entries: [resolve(__dirname, "index.html")],
  },
  build: {
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
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
}));
