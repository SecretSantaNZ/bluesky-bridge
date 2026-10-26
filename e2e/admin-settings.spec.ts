import { test, expect, submitAndWait } from './fixtures.js';
import { createMatch, queueNudge, createTracking } from './helpers/state.js';
import { alice, bob } from './helpers/users.js';

test.describe('admin settings', () => {
  test('game settings can be updated through the form', async ({
    app,
    page,
  }) => {
    await app.login(page, 'headelf');
    await page.goto('/admin/settings');

    await page.locator('#hashtag').fill('#NotTheRealHashtag');
    await page.locator('#signups_open').uncheck();
    await submitAndWait(page, '/admin/settings', () =>
      page.locator('form[action="/admin/settings"] input[type=submit]').click()
    );

    const settings = await app.getSettings();
    expect(settings.hashtag).toBe('#NotTheRealHashtag');
    expect(settings.signups_open).toBe(0);
  });

  test('reset all data clears players, matches, nudges and tracking', async ({
    app,
    page,
  }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await queueNudge(app.db, match.id, 'Hint');
    await createTracking(app.db, match.id);

    await app.login(page, 'headelf');
    await page.goto('/admin/settings');
    page.on('dialog', (dialog) => dialog.accept());
    await submitAndWait(page, '/admin/settings/reset-game', () =>
      page
        .locator('form[action="/admin/settings/reset-game"] input[type=submit]')
        .click()
    );

    expect(await app.db.selectFrom('match').selectAll().execute()).toHaveLength(
      0
    );
    expect(await app.db.selectFrom('nudge').selectAll().execute()).toHaveLength(
      0
    );
    expect(
      await app.db.selectFrom('tracking').selectAll().execute()
    ).toHaveLength(0);
    // Non-booted players are deleted outright
    expect(
      await app.db.selectFrom('player').selectAll().execute()
    ).toHaveLength(0);
  });
});
