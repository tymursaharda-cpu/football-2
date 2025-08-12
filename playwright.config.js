// Playwright configuration for end‑to‑end tests. This is a basic
// placeholder; to run the tests you must install Playwright (`npm
// install -D @playwright/test`) and ensure the game can be served
// locally (e.g. using `npm run dev`). The tests under `tests/ui.spec.ts`
// illustrate how to interact with the PWA using Playwright APIs.

/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: 'tests',
  timeout: 30000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true
  },
  webServer: {
    command: 'npx http-server .',
    port: 8080,
    timeout: 120 * 1000,
    reuseExistingServer: true
  }
};

export default config;