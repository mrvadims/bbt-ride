import { defineConfig } from "vitest/config";

// Unit tests for shared/ and worker logic; kept separate from vite.config.ts (no Cloudflare plugin needed).
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
