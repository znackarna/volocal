import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and must not "tidy up" on it when something fails
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    // 1420, Tauri's default, is often reserved on Windows by Hyper-V or WSL,
    // and the dev server then dies with EACCES.
    //
    // 5183 was the answer to that and stopped being one on 13 August 2026:
    // Windows had taken 5145-5244, so the port refused to bind while nothing
    // was listening on it. That is what EACCES means here — not "in use" but
    // "reserved", and no `netstat` will show it. The command that does:
    //
    //   netsh interface ipv4 show excludedportrange protocol=tcp
    //
    // Those blocks are handed out upward from the lowest one, which was 1440
    // on the machine this was moved for. 1421 sits below every one of them,
    // which is the only property that makes a port less likely to be taken
    // again — a number that merely happens to be free today is what 5183 was.
    host: "127.0.0.1",
    port: 1421,
    strictPort: true,
    watch: {
      // src-tauri is cargo's to watch; vite has no business in it
      ignored: ["**/src-tauri/**"],
    },
  },
});
