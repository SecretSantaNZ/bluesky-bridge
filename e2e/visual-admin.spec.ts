import { test, expect, type AppHandle } from './fixtures.js';
import {
  MOBILE_VIEWPORT,
  hideRandomOrderRows,
  prepareSnapshotPage,
  snapshot,
} from './helpers/visual.js';
import {
  bootPlayer,
  createMatch,
  createTracking,
  queueNudge,
  setSettings,
  snapshotSettings,
} from './helpers/state.js';
import {
  alice,
  bob,
  carol,
  dave,
  eve,
  slowpoke,
  supersanta,
} from './helpers/users.js';

/**
 * Visual snapshots of the admin screens. Baselines are committed for
 * Linux/Chromium; other platforms regenerate with
 * `npx playwright test <file> --update-snapshots`.
 */

const playerId = async (app: AppHandle, user: { did: string }) => {
  const row = await app.db
    .selectFrom('player')
    .select('id')
    .where('did', '=', user.did)
    .executeTakeFirstOrThrow();
  return row.id;
};

test.describe('visual: admin', () => {
  test.beforeEach(async ({ app, page }) => {
    await setSettings(app.db, snapshotSettings());
    await prepareSnapshotPage(page);
    await app.login(page, 'headelf');
  });

  test('dashboard: no issues', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('No issues')).toBeVisible();
    await snapshot(page, 'admin-dashboard-no-issues.png');
  });

  test('dashboard: critical match issues', async ({ app, page }) => {
    await createMatch(app.db, alice.did, bob.did, { match_status: 'locked' });
    await bootPlayer(app.db, bob.did);
    await page.goto('/admin');
    await expect(page.getByText('Critical issues')).toBeVisible();
    await snapshot(page, 'admin-dashboard-critical.png');
  });

  test('dashboard: warn-level match issues', async ({ app, page }) => {
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
    await page.goto('/admin');
    await expect(page.getByText('Match issues')).toBeVisible();
    await snapshot(page, 'admin-dashboard-warn.png');
  });

  test('settings', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.locator('#signups_open')).toBeVisible();
    await snapshot(page, 'admin-settings.png');
  });

  test('manage players', async ({ page }) => {
    await page.goto('/admin/manage-players');
    await expect(page.getByText(/alice\.test\.bsky\.social/)).toBeVisible();
    await snapshot(page, 'admin-manage-players.png');
  });

  test('draft matches', async ({ app, page }) => {
    await createMatch(app.db, alice.did, bob.did, { match_status: 'draft' });
    await page.goto('/admin/draft-matches');
    await expect(
      page.getByRole('heading', { name: 'Draft matches' }).first()
    ).toBeVisible();
    await snapshot(page, 'admin-draft-matches.png');
  });

  test('published matches: shared and locked', async ({ app, page }) => {
    await createMatch(app.db, alice.did, bob.did, { match_status: 'shared' });
    await createMatch(app.db, carol.did, dave.did, { match_status: 'locked' });
    await page.goto('/admin/published-matches');
    await expect(
      page.getByText(/bob\.test\.bsky\.social/).first()
    ).toBeVisible();
    await snapshot(page, 'admin-published-matches.png');
  });

  test('fix-matches: empty', async ({ page }) => {
    await page.goto('/admin/fix-matches');
    await expect(
      page.getByRole('heading', { name: 'Players needing a Santa' })
    ).toBeVisible();
    await hideRandomOrderRows(page);
    await snapshot(page, 'admin-fix-matches-empty.png');
  });

  test('fix-matches: all issue sections', async ({ app, page }) => {
    // Broken: a booted giftee invalidates their match
    await createMatch(app.db, alice.did, bob.did, { match_status: 'locked' });
    await bootPlayer(app.db, bob.did);
    // Too many giftees + multiple giftees: supersanta limited to one
    await app.insertPlayer(supersanta, {
      game_mode: 'Regular',
      max_giftees: 1,
    });
    await createMatch(app.db, supersanta.did, eve.did, {
      match_status: 'shared',
    });
    await createMatch(app.db, supersanta.did, carol.did, {
      match_status: 'shared',
    });
    await page.goto('/admin/fix-matches');
    await expect(
      page.getByRole('heading', { name: 'Broken matches' })
    ).toBeVisible();
    await hideRandomOrderRows(page);
    await snapshot(page, 'admin-fix-matches-all.png');
  });

  test('nudges list', async ({ app, page }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await queueNudge(app.db, match.id, 'Hint', {
      created_at: '2025-12-20T09:00:00.000Z',
    });
    await page.goto('/admin/nudges');
    await expect(
      page.getByText(/bob\.test\.bsky\.social/).first()
    ).toBeVisible();
    // The created column renders relative to the real clock; mask it
    await snapshot(page, 'admin-nudges.png', {
      mask: [page.locator('[x-datetime]')],
    });
  });

  test('tracking list', async ({ app, page }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await createTracking(app.db, match.id, {
      tracking_number: 'NZSNAP0001',
      tracking_status: 'sent',
    });
    await page.goto('/admin/tracking');
    await expect(page.getByText('NZSNAP0001')).toBeVisible();
    await snapshot(page, 'admin-tracking.png');
  });

  test('people without gifts', async ({ app, page }) => {
    await createMatch(app.db, alice.did, bob.did, { match_status: 'locked' });
    await page.goto('/admin/without-gifts');
    await expect(
      page.getByRole('heading', { name: 'People without gifts' })
    ).toBeVisible();
    await hideRandomOrderRows(page);
    await snapshot(page, 'admin-without-gifts.png');
  });

  test("hasn't posted on opening day", async ({ app, page }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await createTracking(app.db, match.id, {
      tracking_number: 'NZSNAP0002',
      tracking_status: 'sent',
    });
    await page.goto('/admin/hasnt-posted');
    await expect(
      page.getByRole('heading', {
        name: "People who haven't posted on opening day",
      })
    ).toBeVisible();
    await snapshot(page, 'admin-hasnt-posted.png');
  });

  test('reassign modal', async ({ app, page }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'shared',
    });
    await page.goto(`/admin/match/${match.id}/reassign`);
    await expect(
      page.getByText('Reassign giftee for @bob.test.bsky.social')
    ).toBeVisible();
    await hideRandomOrderRows(page);
    await snapshot(page, 'admin-reassign-modal.png');
  });

  test('assign santa modal', async ({ app, page }) => {
    await page.goto(
      `/admin/player/${await playerId(app, slowpoke)}/assign-santa`
    );
    await expect(
      page.getByText('Assign giftee for @slowpoke.test.bsky.social')
    ).toBeVisible();
    await hideRandomOrderRows(page);
    await snapshot(page, 'admin-assign-santa-modal.png');
  });

  test('add player modal', async ({ page }) => {
    await page.goto('/admin/manage-players');
    await page.locator('button:has(.i-mdi-add)').first().click();
    await expect(page.getByText('Add player')).toBeVisible();
    await snapshot(page, 'admin-add-player-modal.png', { fullPage: false });
  });

  test('dashboard: no issues (mobile)', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/admin');
    await expect(page.getByText('No issues')).toBeVisible();
    await snapshot(page, 'admin-dashboard-no-issues-mobile.png');
  });

  test('fix-matches: empty (mobile)', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/admin/fix-matches');
    await expect(
      page.getByRole('heading', { name: 'Players needing a Santa' })
    ).toBeVisible();
    await hideRandomOrderRows(page);
    await snapshot(page, 'admin-fix-matches-empty-mobile.png');
  });
});
