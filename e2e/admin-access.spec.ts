import { test, expect } from './fixtures.js';
import { bootPlayer, createMatch } from './helpers/state.js';
import { alice, bob, supersanta } from './helpers/users.js';

test.describe('admin access', () => {
  test('non-admins are redirected away from /admin', async ({ app, page }) => {
    await app.login(page, 'alice');
    await page.goto('/admin/settings');
    // Redirected back to the player home
    await expect(page.locator('#player-home')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Elf tools' })).toHaveCount(0);
  });

  test('elf navigation and home dashboard', async ({ app, page }) => {
    await app.login(page, 'headelf');
    await page.goto('/admin');
    await expect(
      page.getByRole('heading', { name: 'Players', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Draft matches' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Fix matches' })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Manage players' })
    ).toBeVisible();
    await page.getByRole('link', { name: 'Elf tools' }).first().click();
    await expect(
      page.getByRole('heading', { name: 'Players', exact: true })
    ).toBeVisible();
  });

  test('admin home shows the no-issues state', async ({ app, page }) => {
    await app.login(page, 'headelf');
    await page.goto('/admin');
    await expect(page.getByText('No issues')).toBeVisible();
  });

  test('admin home flags critical match issues', async ({ app, page }) => {
    // A booted player breaks their match: critical = broken + too-many-giftees
    await createMatch(app.db, alice.did, bob.did, { match_status: 'locked' });
    await bootPlayer(app.db, bob.did);
    await app.login(page, 'headelf');
    await page.goto('/admin');
    await expect(page.getByText('Critical issues')).toBeVisible();
  });

  test('admin home flags warn-level match issues', async ({ app, page }) => {
    // supersanta holds two giftees within his limit of two: multiple giftees
    // is a warn, not a critical
    await app.insertPlayer(supersanta, {
      game_mode: 'Regular',
      max_giftees: 2,
    });
    await createMatch(app.db, supersanta.did, alice.did, {
      match_status: 'shared',
    });
    await createMatch(app.db, supersanta.did, bob.did, {
      match_status: 'shared',
    });
    await app.login(page, 'headelf');
    await page.goto('/admin');
    await expect(page.getByText('Match issues')).toBeVisible();
  });
});
