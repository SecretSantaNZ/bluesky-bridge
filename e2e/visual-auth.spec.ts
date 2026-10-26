import { test, expect, type AppHandle } from './fixtures.js';
import type { Page } from '@playwright/test';
import {
  MOBILE_VIEWPORT,
  prepareSnapshotPage,
  snapshot,
} from './helpers/visual.js';
import { setSettings, snapshotSettings } from './helpers/state.js';
import { alice } from './helpers/users.js';

/**
 * Visual snapshots of the auth screens. Baselines are committed for
 * Linux/Chromium; other platforms regenerate with
 * `npx playwright test <file> --update-snapshots`.
 */

/** Bounce the fake Bluesky OAuth provider back to the app's callback. */
const fakeProviderRoute = async (app: AppHandle, page: Page) => {
  await page.route('https://fake-bluesky.test/authorize*', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 302,
      headers: {
        location: `${app.baseUrl}/atproto-oauth-callback?code=fake-code&state=${url.searchParams.get('state')}&handle=${url.searchParams.get('handle')}`,
      },
    });
  });
};

test.describe('visual: auth', () => {
  test.beforeEach(async ({ app, page }) => {
    await setSettings(app.db, snapshotSettings());
    await prepareSnapshotPage(page);
  });

  test('login page: choose mode', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
    await snapshot(page, 'login-choose.png');
  });

  test('login page: signup mode', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Sign up', exact: true })
      .first()
      .click();
    await expect(page.getByText('To sign up:')).toBeVisible();
    await snapshot(page, 'login-signup.png');
  });

  test('login page: login mode', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Login', exact: true })
      .first()
      .click();
    await expect(page.locator('#handle')).toBeVisible();
    await snapshot(page, 'login-login.png');
  });

  test('login page: signup with the mastodon tab', async ({ app, page }) => {
    await setSettings(app.db, { ...snapshotSettings(), mastodon_players: 1 });
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Sign up', exact: true })
      .first()
      .click();
    await page.getByRole('button', { name: 'Mastodon', exact: true }).click();
    await expect(page.locator('#handle')).toBeVisible();
    await snapshot(page, 'login-signup-mastodon.png');
  });

  test('login page: signups closed', async ({ app, page }) => {
    await setSettings(app.db, { signups_open: 0 });
    await page.goto('/');
    await expect(page.locator('#handle')).toBeVisible();
    await snapshot(page, 'login-signups-closed.png');
  });

  test('otp code entry screen', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Login', exact: true })
      .first()
      .click();
    await page.locator('#handle').fill(alice.handle);
    await page.getByRole('button', { name: 'Login with DM Code' }).click();
    await expect(page.getByText("You've been DMed a 6 digit code")).toBeVisible(
      { timeout: 10_000 }
    );
    await snapshot(page, 'login-otp-code.png');
  });

  test('signup refused: signups closed screen', async ({ app, page }) => {
    await setSettings(app.db, { signups_open: 0 });
    await fakeProviderRoute(app, page);
    await page.goto('/');
    await page.locator('#handle').fill('toolate.test.bsky.social');
    await page.locator('#login input[type=submit]').click();
    await expect(
      page.getByRole('heading', { name: 'Signups are closed' })
    ).toBeVisible({ timeout: 15_000 });
    await snapshot(page, 'signup-refused-closed.png');
  });

  test('signup refused: not yet open screen', async ({ app, page }) => {
    // Far-future open date: always "not yet open", and the rendered date
    // never drifts.
    await setSettings(app.db, {
      signups_open: 0,
      signups_open_date: '2999-01-01',
    });
    await fakeProviderRoute(app, page);
    await page.goto('/');
    await page.locator('#handle').fill('eager.test.bsky.social');
    await page.locator('#login input[type=submit]').click();
    await expect(
      page.getByRole('heading', { name: 'Soon precious, soon' })
    ).toBeVisible({ timeout: 15_000 });
    await snapshot(page, 'signup-refused-not-open.png');
  });

  test('login page: choose mode (mobile)', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
    await snapshot(page, 'login-choose-mobile.png');
  });
});
