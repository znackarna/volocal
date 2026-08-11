import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and must not "tidy up" on it when something fails
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    // 1420, Tauri's default, is often reserved on Windows by Hyper-V or WSL,
    // and the dev server then dies with EACCES. 5183 tends to be free.
    host: "127.0.0.1",
    port: 5183,
    strictPort: true,
    watch: {
      // src-tauri is cargo's to watch; vite has no business in it
      ignored: ["**/src-tauri/**"],
    },
  },
});
