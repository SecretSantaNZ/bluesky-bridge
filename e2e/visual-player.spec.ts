import { test, expect, submitAndWait } from './fixtures.js';
import {
  MOBILE_VIEWPORT,
  prepareSnapshotPage,
  snapshot,
} from './helpers/visual.js';
import {
  assignBadge,
  bootPlayer,
  createBadge,
  createMatch,
  createTracking,
  queueNudge,
  setSettings,
  snapshotSettings,
} from './helpers/state.js';
import { alice, bob, dave, eve, oldfriend } from './helpers/users.js';

/**
 * Visual snapshots of the player screens. Baselines are committed for
 * Linux/Chromium; other platforms regenerate with
 * `npx playwright test <file> --update-snapshots`.
 */

test.describe('visual: player', () => {
  test.beforeEach(async ({ app }) => {
    await setSettings(app.db, snapshotSettings());
  });

  test('player home: empty states', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.locator('#player-home')).toBeVisible();
    await snapshot(page, 'player-home-empty.png');
  });

  test('player home: locked giftee with nudge and tracking', async ({
    app,
    page,
  }) => {
    await prepareSnapshotPage(page);
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await queueNudge(app.db, match.id, 'Hint', {
      created_at: '2025-12-20T09:00:00.000Z',
    });
    await createTracking(app.db, match.id, {
      tracking_number: 'NZSNAP0001',
      tracking_status: 'sent',
    });
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.getByText(bob.address ?? '')).toBeVisible();
    // The nudge datetime renders relative to the real clock; mask it
    await snapshot(page, 'player-home-locked-giftee.png', {
      mask: [page.locator('#nudges-ive-sent-card [x-datetime]')],
    });
  });

  test('player home: shared giftee, address not released', async ({
    app,
    page,
  }) => {
    await prepareSnapshotPage(page);
    await createMatch(app.db, alice.did, bob.did, { match_status: 'shared' });
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(
      page.getByText('Address will be released soon.')
    ).toBeVisible();
    await snapshot(page, 'player-home-shared-giftee.png');
  });

  test('player home: follow-santa banner', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await app.insertPlayer(dave, { not_following: true });
    await app.login(page, 'dave');
    await page.goto('/');
    await expect(
      page.getByText('You must follow @secretsanta.nz')
    ).toBeVisible();
    await snapshot(page, 'player-home-follow-banner.png');
  });

  test('player home: DM failure banner', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await app.db
      .updateTable('player')
      .set({ player_dm_status: 'error: Bluesky is down' })
      .where('did', '=', alice.did)
      .execute();
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(
      page.getByText('@secretsanta.nz could not DM you')
    ).toBeVisible();
    await snapshot(page, 'player-home-dm-error.png');
  });

  test('player home: bridged to mastodon, no banner', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await app.db
      .updateTable('player')
      .set({ mastodon_account: 'alice@mastodon.test' })
      .where('did', '=', alice.did)
      .execute();
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.getByText("You haven't bridged to Mastodon")).toHaveCount(
      0
    );
    await snapshot(page, 'player-home-bridged.png');
  });

  test('player home: badges card', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    const badge = await createBadge(app.db, 'Opening Day Star');
    await assignBadge(app.db, oldfriend.did, badge.id);
    await app.login(page, 'oldfriend');
    await page.goto('/');
    await expect(page.locator('#my-badges-card img')).toBeVisible();
    await snapshot(page, 'player-home-badges.png');
  });

  test('player home: presents for me', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    const match = await createMatch(app.db, bob.did, alice.did, {
      match_status: 'locked',
    });
    await createTracking(app.db, match.id, {
      tracking_number: 'NZSNAP0002',
      tracking_status: 'sent',
    });
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.getByText("is on it's way!")).toBeVisible();
    await snapshot(page, 'player-home-presents-for-me.png');
  });

  test('player home: mastodon player with follow banners', async ({
    app,
    page,
  }) => {
    await prepareSnapshotPage(page);
    await app.insertPlayer(eve, {
      player_type: 'mastodon',
      mastodon_account: 'eve@mastodon.test',
      mastodon_host: 'mastodon.test',
      not_following: true,
    });
    await app.login(page, 'eve');
    await page.goto('/');
    await expect(
      page.getByText('You must follow @secretsanta.nz@bsky.brid.gy')
    ).toBeVisible();
    await snapshot(page, 'player-home-mastodon-banners.png');
  });

  test('player home: mastodon player, following', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await app.insertPlayer(eve, {
      player_type: 'mastodon',
      mastodon_account: 'eve@mastodon.test',
      mastodon_host: 'mastodon.test',
    });
    await app.db
      .updateTable('player')
      .set({ following_santa_uri: 'mastodon', mastodon_following_santa: 1 })
      .where('did', '=', eve.did)
      .execute();
    await app.login(page, 'eve');
    await page.goto('/');
    await expect(
      page.getByText('You must follow @secretsanta.nz@bsky.brid.gy')
    ).toHaveCount(0);
    await snapshot(page, 'player-home-mastodon-clean.png');
  });

  test('onboarding: forced address screen', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await app.login(page, 'slowpoke');
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: "I can't find my address" })
    ).toBeVisible();
    await snapshot(page, 'onboarding-address.png');
  });

  test('onboarding: game mode, regular', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await app.login(page, 'slowpoke');
    await page.goto('/');
    await page.getByRole('button', { name: "I can't find my address" }).click();
    await page
      .locator('input[name=address]')
      .fill('123 Snapshot Street, Wellington, New Zealand');
    await submitAndWait(page, '/address', () =>
      page.locator('#modal-content input[type=submit]').click()
    );
    await expect(page.locator('#game_mode')).toBeVisible();
    await page.locator('#game_mode').selectOption({ label: 'Regular' });
    await expect(page.locator('#max_giftees')).toBeHidden();
    await snapshot(page, 'onboarding-game-mode-regular.png');
  });

  test('onboarding: game mode, super santa', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await app.login(page, 'slowpoke');
    await page.goto('/');
    await page.getByRole('button', { name: "I can't find my address" }).click();
    await page
      .locator('input[name=address]')
      .fill('123 Snapshot Street, Wellington, New Zealand');
    await submitAndWait(page, '/address', () =>
      page.locator('#modal-content input[type=submit]').click()
    );
    await expect(page.locator('#game_mode')).toBeVisible();
    await page.locator('#game_mode').selectOption({ label: 'Super Santa' });
    await page.locator('#max_giftees').fill('3');
    await snapshot(page, 'onboarding-game-mode-super.png');
  });

  test('opt out: confirm modal', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await app.login(page, 'shy');
    await page.goto('/');
    await page.locator('#opt-out-button').click();
    await expect(
      page.getByText('If you opt out after the Giftees')
    ).toBeVisible();
    await snapshot(page, 'opt-out-modal.png', { fullPage: false });
  });

  test('opted out: signups open', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await app.login(page, 'shy');
    await page.goto('/');
    await page.locator('#opt-out-button').click();
    await submitAndWait(page, '/opt-out', () =>
      page.locator('#modal-content input[type=submit]').click()
    );
    await page.reload();
    await expect(page.getByText('you can opt back in')).toBeVisible();
    await snapshot(page, 'opted-out-open.png');
  });

  test('opted out: signups closed', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await setSettings(app.db, { signups_open: 0 });
    await app.login(page, 'shy');
    await page.goto('/');
    await page.locator('#opt-out-button').click();
    await submitAndWait(page, '/opt-out', () =>
      page.locator('#modal-content input[type=submit]').click()
    );
    await page.reload();
    await expect(page.getByText('DM @secretsanta.nz')).toBeVisible();
    await snapshot(page, 'opted-out-closed.png');
  });

  test('booted out screen', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.locator('#player-home')).toBeVisible();
    await bootPlayer(app.db, alice.did);
    await page.reload();
    await expect(
      page.getByText('You have been removed from the game.')
    ).toBeVisible();
    await snapshot(page, 'booted-out.png');
  });

  test('badge modal', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    const badge = await createBadge(app.db, 'Opening Day Star');
    await assignBadge(app.db, oldfriend.did, badge.id);
    await app.login(page, 'oldfriend');
    await page.goto('/');
    await page.locator('#my-badges-card img').click();
    await expect(
      page.getByRole('heading', { name: 'Opening Day Star' })
    ).toBeVisible();
    await snapshot(page, 'badge-modal.png', { fullPage: false });
  });

  test('send nudge modal', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await createMatch(app.db, alice.did, bob.did, { match_status: 'locked' });
    await app.login(page, 'alice');
    await page.goto('/');
    await page
      .locator('#my-giftee-card')
      .getByRole('link', { name: 'Nudge' })
      .click();
    await expect(page.locator('form#modal-content')).toBeVisible();
    await snapshot(page, 'send-nudge-modal.png', { fullPage: false });
  });

  test('add tracking modal', async ({ app, page }) => {
    await prepareSnapshotPage(page);
    await createMatch(app.db, alice.did, bob.did, { match_status: 'locked' });
    await app.login(page, 'alice');
    await page.goto('/');
    await page
      .locator('#my-giftee-card')
      .getByRole('link', { name: 'Add sent present' })
      .click();
    await expect(page.locator('form#modal-content')).toBeVisible();
    // The shipped date defaults to today's date client-side; pin it
    await page.locator('#shipped_date').fill('2025-12-20');
    await snapshot(page, 'add-tracking-modal.png', { fullPage: false });
  });

  test('player home: empty states (mobile)', async ({ app, page }) => {
    await prepareSnapshotPage(page, MOBILE_VIEWPORT);
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.locator('#player-home')).toBeVisible();
    await snapshot(page, 'player-home-empty-mobile.png');
  });

  test('player home: locked giftee (mobile)', async ({ app, page }) => {
    await prepareSnapshotPage(page, MOBILE_VIEWPORT);
    await createMatch(app.db, alice.did, bob.did, { match_status: 'locked' });
    await app.login(page, 'alice');
    await page.goto('/');
    // Wait for Alpine to initialise (it strips x-cloak), then expand the
    // collapsed "My giftee" card
    await expect(page.locator('#page-body')).not.toHaveAttribute('x-cloak');
    await page.locator('#my-giftee-card > div').first().click();
    await expect(page.getByText(bob.address ?? '')).toBeVisible();
    await snapshot(page, 'player-home-locked-giftee-mobile.png');
  });

  test('player home: mastodon banners (mobile)', async ({ app, page }) => {
    await prepareSnapshotPage(page, MOBILE_VIEWPORT);
    await app.insertPlayer(eve, {
      player_type: 'mastodon',
      mastodon_account: 'eve@mastodon.test',
      mastodon_host: 'mastodon.test',
      not_following: true,
    });
    await app.login(page, 'eve');
    await page.goto('/');
    await expect(
      page.getByText('You must follow @secretsanta.nz@bsky.brid.gy')
    ).toBeVisible();
    await snapshot(page, 'player-home-mastodon-banners-mobile.png');
  });
});
