import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error node types are not needed just for this
import process from "node:process";

// the app version (package.json), shown in Settings → About
const version: string = process.env.npm_package_version ?? "0.0.0";

// Tauri expects a fixed dev port.
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
}));
