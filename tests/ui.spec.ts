// End‑to‑end tests using Playwright. These tests verify that the menu
// appears, the match can be started, and the scoreboard updates. They
// serve as a template; running them requires `@playwright/test` and
// launching a local web server (see playwright.config.js).

import { test, expect } from '@playwright/test';

// Base URL points to the root of the PWA. Adjust if serving from a
// different path.
const BASE_URL = 'http://localhost:8080/miomi-football/index.html';

test('main menu displays and starts a match', async ({ page }) => {
  await page.goto(BASE_URL);
  // Wait for the title to render
  await page.getByText('Arcade Football 1v1').waitFor();
  // Click play button
  await page.getByText('Играть против AI').click();
  // Wait for scoreboard to appear and verify initial score
  const score = await page.getByText(/0\s*:\s*0/).textContent();
  expect(score).toBeTruthy();
});