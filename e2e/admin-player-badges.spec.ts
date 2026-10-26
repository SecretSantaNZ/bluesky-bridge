import { test, expect, submitAndWait } from './fixtures.js';
import { createBadge, defaultSettings, setSettings } from './helpers/state.js';
import type { AppHandle } from './fixtures.js';
import { oldfriend } from './helpers/users.js';

const playerId = async (app: AppHandle, user: { did: string }) => {
  const row = await app.db
    .selectFrom('player')
    .select('id')
    .where('did', '=', user.did)
    .executeTakeFirstOrThrow();
  return row.id;
};

/**
 * Exercises badge assignment/removal through the admin player screen.
 */
test.describe('admin player badges', () => {
  test.beforeEach(async ({ app }) => {
    await setSettings(app.db, defaultSettings());
  });

  test('assign and remove badges', async ({ app, page }) => {
    const badge = await createBadge(app.db, 'Elf Helpers');
    await app.login(page, 'headelf');
    const oldfriendId = await playerId(app, oldfriend);
    await page.goto(`/admin/player/${oldfriendId}/badges`);

    // assign: the "add badge" button submits the form with the chosen badge
    const assignForm = page.locator(
      `form[action="/admin/player/${oldfriendId}/badges"]`
    );
    await assignForm
      .locator('select[name=badge_id]')
      .selectOption(String(badge.id));
    await submitAndWait(page, `/badges`, () =>
      assignForm.locator('button:has(.i-mdi-add)').click()
    );
    const assigned = await app.db
      .selectFrom('player_badge')
      .selectAll()
      .where('badge_id', '=', badge.id)
      .execute();
    expect(assigned).toHaveLength(1);

    // remove it again
    await submitAndWait(page, `/badges/${badge.id}/delete`, () =>
      page
        .locator(
          `form[action="/admin/player/${oldfriendId}/badges/${badge.id}/delete"]`
        )
        .locator('button:has(.i-mdi-trash-can-outline)')
        .click()
    );
    expect(
      await app.db
        .selectFrom('player_badge')
        .selectAll()
        .where('badge_id', '=', badge.id)
        .execute()
    ).toHaveLength(0);
  });
});
