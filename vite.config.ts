import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri ocekava pevny port a nesmi na nem "uklizet" pri chybe
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    // 1420 (výchozí u Tauri) si na Windows často vyhradí Hyper-V nebo WSL
    // a vývojový server pak spadne na EACCES. 5183 bývá volný.
    host: "127.0.0.1",
    port: 5183,
    strictPort: true,
    watch: {
      // src-tauri hlida cargo, vite do toho nema co mluvit
      ignored: ["**/src-tauri/**"],
    },
  },
});
