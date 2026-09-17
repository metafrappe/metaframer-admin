import { existsSync } from "node:fs";
import { chromium, defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4300";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/ui.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (existsSync(chromium.executablePath()) ? undefined : "chrome"),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
  },
  webServer: {
    command: "npm run dev",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: "4300",
      HOST: "127.0.0.1",
      APP_ORIGIN: baseURL,
      NODE_ENV: "development",
    },
  },
});
