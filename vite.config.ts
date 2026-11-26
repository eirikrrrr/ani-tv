import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev server on all interfaces: the Windows dev build on another PC of the LAN
// loads the UI from here, so UI changes hot-reload without rebuilding the .exe.
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "0.0.0.0",
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
}));
