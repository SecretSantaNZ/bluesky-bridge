import { test, expect, submitAndWait, type AppHandle } from './fixtures.js';
import type { Page } from '@playwright/test';
import { getPlayerRow, setSettings } from './helpers/state.js';
import { mastodonHost } from './helpers/fake-mastodon.js';

const newbieHandle = 'newbie.test.bsky.social';
const newbieDid = 'did:plc:e2enewbie';

test.describe('bluesky signup', () => {
  test('brand-new user signs up via fake OAuth and completes onboarding', async ({
    app,
    page,
  }) => {
    // The fake OAuth provider URL minted by the atOauthClient stub in
    // fixtures.ts: bounce straight back to the app's callback route with the
    // stored state key (page routes take precedence over the context route
    // that aborts everything off-baseUrl).
    await page.route('https://fake-bluesky.test/authorize*', async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        status: 302,
        headers: {
          location: `${app.baseUrl}/atproto-oauth-callback?code=fake-code&state=${url.searchParams.get('state')}&handle=${url.searchParams.get('handle')}`,
        },
      });
    });

    await page.goto('/');
    await page
      .getByRole('button', { name: 'Sign up', exact: true })
      .first()
      .click();
    await page.locator('#handle').fill(newbieHandle);
    // The POST responds with a server-events view that navigates the browser
    // through the (faked) provider round-trip, so just click and wait for the
    // page the callback lands on.
    await page.locator('#login input[type=submit]').click();

    // Forced onboarding: the address form first
    await expect(
      page.getByRole('button', { name: "I can't find my address" })
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: "I can't find my address" }).click();
    await page
      .locator('input[name=address]')
      .fill('1 Newbie Lane, Wellington, New Zealand');
    await page.locator('#delivery_instructions').fill('Knock loudly');
    await submitAndWait(page, '/address', () =>
      page.locator('#modal-content input[type=submit]').click()
    );

    // Then the game mode
    await expect(page.locator('#game_mode')).toBeVisible();
    await page.locator('#game_mode').selectOption({ label: 'Regular' });
    await submitAndWait(page, '/game-mode', () =>
      page.locator('#modal-content input[type=submit]').click()
    );

    await expect(page.locator('#player-home')).toBeVisible({
      timeout: 10_000,
    });
    const player = await getPlayerRow(app.db, newbieDid);
    expect(player.player_type).toBe('bluesky');
    expect(player.handle).toBe(newbieHandle);
    expect(player.address).toContain('Newbie Lane');
    expect(player.game_mode).toBe('Regular');
    expect(player.max_giftees).toBe(1);
    // profile_complete flips via the address+game_mode DB trigger;
    // signup_complete additionally needs following_santa_uri, which only the
    // background profile refresh (not started in e2e) sets.
    expect(player.profile_complete).toBe(1);
    expect(player.signup_complete).toBe(0);
  });
});

test.describe('mastodon signup', () => {
  test.beforeEach(async ({ app }) => {
    // The login page only renders the Mastodon tab when enabled in settings
    // (the migration default is off).
    await setSettings(app.db, { mastodon_players: 1 });
  });

  test('brand-new mastodon user signs up and completes onboarding', async ({
    app,
    page,
  }) => {
    // Same bounce trick as the Bluesky signup, against the fake Mastodon
    // instance's authorize URL.
    await page.route(
      `https://${mastodonHost}/oauth/authorize*`,
      async (route) => {
        const url = new URL(route.request().url());
        await route.fulfill({
          status: 302,
          headers: {
            location: `${app.baseUrl}/mastodon/callback?code=fake-code&state=${url.searchParams.get('state')}`,
          },
        });
      }
    );

    await page.goto('/');
    await page
      .getByRole('button', { name: 'Sign up', exact: true })
      .first()
      .click();
    await page.getByRole('button', { name: 'Mastodon', exact: true }).click();
    await page.locator('#handle').fill('newbie@mastodon.test');
    // The POST responds with a server-events view that navigates the browser
    // through the (faked) provider round-trip, so just click and wait for the
    // page the callback lands on.
    await page.locator('#login input[type=submit]').click();

    // Forced onboarding: the address form first
    await expect(
      page.getByRole('button', { name: "I can't find my address" })
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: "I can't find my address" }).click();
    await page
      .locator('input[name=address]')
      .fill('3 Mastodon Way, Wellington, New Zealand');
    await page.locator('#delivery_instructions').fill('Use the side gate');
    await submitAndWait(page, '/address', () =>
      page.locator('#modal-content input[type=submit]').click()
    );

    // Then the game mode
    await expect(page.locator('#game_mode')).toBeVisible();
    await page.locator('#game_mode').selectOption({ label: 'Regular' });
    await submitAndWait(page, '/game-mode', () =>
      page.locator('#modal-content input[type=submit]').click()
    );

    await expect(page.locator('#player-home')).toBeVisible({
      timeout: 10_000,
    });
    const player = await getPlayerRow(app.db, newbieDid);
    expect(player.player_type).toBe('mastodon');
    expect(player.mastodon_account).toBe('newbie@mastodon.test');
    expect(player.mastodon_host).toBe('mastodon.test');
    // The bridged Bluesky handle (bridgy-fed) resolves to the player's DID
    expect(player.handle).toBe(newbieHandle);
    expect(player.address).toContain('Mastodon Way');
    expect(player.game_mode).toBe('Regular');
    expect(player.max_giftees).toBe(1);
    // Same DB trigger semantics as the bluesky signup above
    expect(player.profile_complete).toBe(1);
    expect(player.signup_complete).toBe(0);
  });
});

test.describe('signup refusals', () => {
  const refusedHandle = 'toolate.test.bsky.social';

  const attemptSignup = async (app: AppHandle, page: Page) => {
    await page.route('https://fake-bluesky.test/authorize*', async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        status: 302,
        headers: {
          location: `${app.baseUrl}/atproto-oauth-callback?code=fake-code&state=${url.searchParams.get('state')}&handle=${url.searchParams.get('handle')}`,
        },
      });
    });
    await page.goto('/');
    // With signups closed the card starts in login mode (no Sign up button);
    // otherwise switch to signup mode first.
    const signupButton = page
      .getByRole('button', { name: 'Sign up', exact: true })
      .first();
    if (await signupButton.isVisible()) {
      await signupButton.click();
    }
    await page.locator('#handle').fill(refusedHandle);
    await page.locator('#login input[type=submit]').click();
  };

  const refusedRows = async (app: AppHandle) =>
    app.db
      .selectFrom('player')
      .selectAll()
      .where('handle', '=', refusedHandle)
      .execute();

  test('signing up while signups are closed shows the closed screen', async ({
    app,
    page,
  }) => {
    await setSettings(app.db, { signups_open: 0 });
    await attemptSignup(app, page);

    await expect(
      page.getByRole('heading', { name: 'Signups are closed' })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/@toolate\.test\.bsky\.social, the game has begun/)
    ).toBeVisible();
    expect(await refusedRows(app)).toHaveLength(0);
  });

  test('signing up before the opening date shows the not-yet-open screen', async ({
    app,
    page,
  }) => {
    const opensInAMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await setSettings(app.db, {
      signups_open: 0,
      signups_open_date: opensInAMonth,
    });
    await attemptSignup(app, page);

    await expect(
      page.getByRole('heading', { name: 'Soon precious, soon' })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/signups don't open until/)).toBeVisible();
    expect(await refusedRows(app)).toHaveLength(0);
  });
});
