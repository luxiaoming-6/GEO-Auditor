import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./src/manifest.ts";

// The crx plugin reads every entry from the manifest (popup html, service
// worker, content scripts) and wires them into the build pipeline.
//   - `pnpm dev`   -> dev server with HMR + a dev manifest written to dist/
//   - `pnpm build` -> production bundle written to dist/
export default defineConfig({
  plugins: [crx({ manifest })],
  server: {
    // Keep the port stable: the dev-mode manifest loaded in Chrome points at it.
    // 5173/5180 are already taken by other dev servers on this machine.
    port: 5185,
    strictPort: true,
  },
});
