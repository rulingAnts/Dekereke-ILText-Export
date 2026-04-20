import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isWeb = process.env.BUILD_TARGET === "web";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  base: isWeb ? "./" : "/",
  build: isWeb
    ? { outDir: "docs", emptyOutDir: true }
    : undefined,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
