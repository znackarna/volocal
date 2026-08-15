import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and must not "tidy up" on it when something fails
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    // 1420, Tauri's default, is often reserved on Windows by Hyper-V or WSL,
    // and the dev server then dies with EACCES. That is what EACCES means here
    // — not "in use" but "reserved", and no `netstat` will show it. The two
    // commands that do:
    //
    //   netsh interface ipv4 show excludedportrange protocol=tcp
    //   netsh interface ipv4 show dynamicport tcp
    //
    // 5183 was the first answer and stopped being one on 13 August 2026;
    // 1421 was the second and stopped being one on 14 August 2026, on a second
    // machine where the reserved blocks begin at 1041 rather than 1440. Both
    // failed the same way, because both were chosen from the exclusion list —
    // a number that happens to be free on the machine in front of us.
    //
    // The exclusions are handed out inside the dynamic port range, so the
    // property to pick for is being outside that range on both kinds of
    // machine: above a lowered range (1024 + 13977 = 15000 here) and below the
    // 49152 an untouched Windows starts its own at. 17420 is in that gap.
    host: "127.0.0.1",
    port: 17420,
    strictPort: true,
    watch: {
      // src-tauri is cargo's to watch; vite has no business in it
      ignored: ["**/src-tauri/**"],
    },
  },
});
