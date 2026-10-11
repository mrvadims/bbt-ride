import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare()],
  // 8787 matches the localhost origin and redirect URI registered with Google.
  server: { port: 8787, strictPort: true },
});
