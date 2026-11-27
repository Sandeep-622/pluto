import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node scripts/test-host.mjs --serve",
      url: "http://localhost:7071/api/health",
      reuseExistingServer: false,
      timeout: 120000
    },
    {
      command: "node node_modules/serve/build/main.js out --listen tcp://127.0.0.1:3100 --no-clipboard",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      timeout: 30000
    }
  ]
});
