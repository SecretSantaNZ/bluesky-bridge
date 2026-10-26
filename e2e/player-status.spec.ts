import { test, expect, submitAndWait } from './fixtures.js';
import { bootPlayer, optOutPlayer, setSettings } from './helpers/state.js';
import { alice, headelf, shy } from './helpers/users.js';

test.describe('player status', () => {
  test('opt out and back in again while signups are open', async ({
    app,
    page,
  }) => {
    await app.login(page, 'shy');
    await page.goto('/');
    await page.locator('#opt-out-button').click();
    // Confirm in the modal
    await expect(
      page.getByText('If you opt out after the Giftees')
    ).toBeVisible();
    await submitAndWait(page, '/opt-out', () =>
      page.locator('#modal-content input[type=submit]').click()
    );
    expect(
      await app.db
        .selectFrom('player')
        .select('opted_out')
        .where('did', '=', shy.did)
        .executeTakeFirstOrThrow()
        .then((r) => r.opted_out)
    ).not.toBeNull();

    // Reload shows the opted-out screen with the opt back in option
    await page.reload();
    await expect(page.getByText('you can opt back in')).toBeVisible();
    await submitAndWait(page, '/opt-in', () =>
      page.getByRole('button', { name: 'Opt back in' }).first().click()
    );

    expect(
      await app.db
        .selectFrom('player')
        .select('opted_out')
        .where('did', '=', shy.did)
        .executeTakeFirstOrThrow()
        .then((r) => r.opted_out)
    ).toBeNull();
    await expect(page.locator('#player-home')).toBeVisible();
  });

  test('opt-out screen has no opt-in option once signups are closed', async ({
    app,
    page,
  }) => {
    await optOutPlayer(app.db, shy.did);
    await setSettings(app.db, { signups_open: 0 });
    await app.login(page, 'shy');
    await page.goto('/');
    await expect(page.getByText('You opted out of the game.')).toBeVisible();
    await expect(page.getByText("it's okay", { exact: false })).toBeHidden();
  });

  test('an elf stays an elf even when booted', async ({ app, page }) => {
    await bootPlayer(app.db, headelf.did);
    await app.login(page, 'headelf');
    await page.goto('/');
    await expect(
      page.getByText('You have been removed from the game.')
    ).toBeVisible();
    await page.getByRole('link', { name: 'Elf tools' }).click();
    await expect(page.getByText('Starting the game')).toBeVisible();
  });

  test('live session is killed once the player is booted', async ({
    app,
    page,
  }) => {
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.locator('#player-home')).toBeVisible();
    await bootPlayer(app.db, alice.did);
    // The browser client reloads when the keep-alive endpoint rejects
    await page.reload();
    await expect(
      page.getByText('You have been removed from the game.')
    ).toBeVisible({ timeout: 10_000 });
    // The session cookie is gone now -- the next request hits the login page
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
  });

  test('session keep-alive keeps valid sessions alive', async ({
    app,
    page,
  }) => {
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.locator('#player-home')).toBeVisible();
    await expect(await page.request.get('/session-keep-alive')).toBeOK();
  });
});
