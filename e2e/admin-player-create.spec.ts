import { test, expect, submitAndWait } from './fixtures.js';
import { defaultSettings, setSettings } from './helpers/state.js';

/**
 * KNOWN FAILING: POST /admin/player responds 500 in the e2e harness. To be
 * revisited -- likely the googlePlaces stub or the santa agent resolveHandle
 * for a newly created (non-static) handle.
 */
test.describe('admin player create', () => {
  test.beforeEach(async ({ app }) => {
    await setSettings(app.db, defaultSettings());
  });

  test('add a player manually (bluesky flavour)', async ({ app, page }) => {
    await app.login(page, 'headelf');
    await page.goto('/admin/manage-players');
    // Open the "Add player" modal (icon button in the manage card header)
    await page.locator('button:has(.i-mdi-add)').first().click();
    await expect(page.getByText('Add player')).toBeVisible({
      timeout: 10_000,
    });

    await page.locator('#new_player_handle').fill('manual.test.bsky.social');
    await page.getByRole('button', { name: "I can't find my address" }).click();
    await page
      .locator('input[name=address]')
      .fill('1 Manual Road, Wellington, New Zealand');
    await page.locator('#new_player_delivery_instructions').fill('Gate two');
    await submitAndWait(page, '/admin/player', () =>
      page.locator('form#new-player input[type=submit]').click()
    );

    const created = await app.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', 'did:plc:e2emanual')
      .executeTakeFirstOrThrow();
    expect(created.handle).toBe('manual.test.bsky.social');
    expect(created.address).toContain('Manual Road');
  });
});
