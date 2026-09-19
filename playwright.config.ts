import { defineConfig, devices } from "@playwright/test";

// Runs against the production build served by `astro preview`, so build
// first (`pnpm build`). Pages Functions (/api/*) aren't served here; the
// UI must degrade gracefully without them, which is itself under test.
const PORT = 4329;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `pnpm exec astro preview --port ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
  },
});
