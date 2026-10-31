/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5190, strictPort: true, host: true },
  preview: { port: 5190, strictPort: true, host: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    testTimeout: 30000,
    // 4 test files don't need a worker per core; fewer forks = less contention when the
    // suite runs alongside the dev server and the exporter (smoke.sh)
    maxWorkers: 4,
  },
});
