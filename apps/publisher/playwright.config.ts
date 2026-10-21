import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/globalSetup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { trace: "retain-on-failure" },
})
