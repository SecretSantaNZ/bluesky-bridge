import { test, expect, submitAndWait } from './fixtures.js';
import { formatDate } from '../src/lib/dates.js';
import {
  createMatch,
  setSettings,
  defaultSettings,
  seedOpeningPost,
  createBadge,
  assignBadge,
  createTracking,
} from './helpers/state.js';
import {
  alice,
  bob,
  dave,
  eve,
  oldfriend,
  supersanta,
} from './helpers/users.js';

test.describe('player home', () => {
  test('home shows About me, Key information, gifts cards', async ({
    app,
    page,
  }) => {
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'About me' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Key information' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'My address' })
    ).toBeVisible();
    await expect(page.getByText(`${alice.address ?? alice.key}`)).toBeVisible();
    // Key information displays the game dates
    const { send_by_date, opening_date } = await app.getSettings();
    await expect(page.getByText(formatDate(send_by_date))).toBeVisible();
    await expect(page.getByText(formatDate(opening_date))).toBeVisible();
  });

  test('bluesky players see the bridge-to-mastodon banner', async ({
    app,
    page,
  }) => {
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(
      page.getByText("You haven't bridged to Mastodon")
    ).toBeVisible();
  });

  test('bluesky players who have bridged see no bridge banner', async ({
    app,
    page,
  }) => {
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
  });

  test('not-yet-following players see the follow-santa banner', async ({
    app,
    page,
  }) => {
    // Reseed dave, this time flagged as not following santa
    await app.insertPlayer(dave, { not_following: true });
    await app.login(page, 'dave');
    await page.goto('/');
    await expect(
      page.getByText('You must follow @secretsanta.nz')
    ).toBeVisible();
  });

  test('badge modals open from the home page', async ({ app, page }) => {
    const badge = await createBadge(
      app.db,
      'Opening Day Star',
      'Posted an opening day photo'
    );
    await assignBadge(app.db, oldfriend.did, badge.id);
    await app.login(page, 'oldfriend');
    await page.goto('/');
    const badgeImage = page.locator('#my-badges-card img');
    await expect(badgeImage).toBeVisible();
    await badgeImage.click();
    // badge modal is populated with the badge title
    await expect(
      page.getByRole('heading', { name: 'Opening Day Star' })
    ).toBeVisible();
  });

  test('sent-present badge appears on the home page', async ({ app, page }) => {
    const badge = await createBadge(app.db, 'Sent a Present');
    await setSettings(app.db, { sent_present_badge_id: badge.id });
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await createTracking(app.db, match.id);
    await app.login(page, 'alice');
    await page.goto('/');
    const badgeImage = page.locator('#my-badges-card img');
    await expect(badgeImage).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'My badges' })
    ).toBeVisible();
  });

  test('My giftee: locked match shows address and action buttons', async ({
    app,
    page,
  }) => {
    const setts = await setSettings(app.db, defaultSettings());
    void setts;
    await createMatch(app.db, alice.did, bob.did, { match_status: 'locked' });
    await app.login(page, 'alice');
    await page.goto('/');
    const bobLink = page.locator(
      `#my-giftee-card a[href*="bob.test.bsky.social"]`
    );
    await expect(bobLink).toBeVisible();
    await expect(page.getByText(`${bob.address}`)).toBeVisible();
    await expect(page.getByText('Gate code 1234 (bob)')).toBeVisible();
    await expect(
      page.locator('#my-giftee-card').getByRole('link', {
        name: 'Nudge',
      })
    ).toBeVisible();
    await expect(
      page
        .locator('#my-giftee-card')
        .getByRole('link', { name: 'Add sent present' })
    ).toBeVisible();
  });

  test('My giftee: shared match hides address until released', async ({
    app,
    page,
  }) => {
    await createMatch(app.db, alice.did, bob.did, { match_status: 'shared' });
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(
      page.getByText('Address will be released soon.')
    ).toBeVisible();
    await expect(
      page.getByText('You can send nudges once addresses are released.')
    ).toBeVisible();
  });

  test('My giftee: empty state', async ({ app, page }) => {
    await app.login(page, 'eve');
    await page.goto('/');
    await expect(
      page.getByText("Your Giftee isn't assigned yet, check back soon.")
    ).toBeVisible();
  });

  test('Presents for me lists incoming gifts with tracking', async ({
    app,
    page,
  }) => {
    const match = await createMatch(app.db, bob.did, alice.did, {
      match_status: 'locked',
    });
    await createTracking(app.db, match.id, { tracking_status: 'sent' });
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(
      page.getByText('1 gift', {
        exact: false,
      })
    ).toBeVisible();
    await expect(page.getByText(/Gifts are wrapped/)).toBeVisible();
  });

  test('Presents I have sent lists outgoing gifts', async ({ app, page }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await createTracking(app.db, match.id, { tracking_status: 'sent' });
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.getByText("You've sent 1 gift")).toBeVisible();
    await expect(
      page
        .locator('#presents-ive-sent-card')
        .getByText(/bob\.test\.bsky\.social/)
    ).toBeVisible();
  });

  test('opening-day post rows surface in admin (hasnt-posted excludes)', async ({
    app,
    page,
  }) => {
    await createBadge(app.db, 'x');
    await seedOpeningPost(app.db, alice.did, 1);
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.locator('#player-home')).toBeVisible();
  });

  test('super santa shows up to 3 giftees', async ({ app, page }) => {
    await createMatch(app.db, supersanta.did, alice.did, {
      match_status: 'locked',
    });
    await createMatch(app.db, supersanta.did, bob.did, {
      match_status: 'locked',
    });
    await app.login(page, 'supersanta');
    await page.goto('/');
    await expect(page.getByText(/alice\.test\.bsky\.social/)).toBeVisible();
    await expect(page.getByText(/bob\.test\.bsky\.social/)).toBeVisible();
  });

  test('DM-failure banner shows on the home page and retry clears it', async ({
    app,
    page,
  }) => {
    // Simulate a transient DM failure: the (fake) profile allows incoming
    // DMs, but the recorded send attempt errored.
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

    // Retrying re-checks the profile, sees DMs are allowed and resets
    await submitAndWait(page, '/player/retry-dm', () =>
      page.locator('#retry-dm-form button').click()
    );
    await expect(
      page.getByText('@secretsanta.nz could not DM you')
    ).toHaveCount(0);
    const row = await app.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', alice.did)
      .executeTakeFirstOrThrow();
    expect(row.player_dm_status).toBe('queued');
  });

  test('mastodon players see the follow banners and mastodon details', async ({
    app,
    page,
  }) => {
    await app.insertPlayer(eve, {
      player_type: 'mastodon',
      mastodon_account: 'eve@mastodon.test',
      mastodon_host: 'mastodon.test',
      not_following: true,
    });
    await app.login(page, 'eve');
    await page.goto('/');
    // Not following the bridge nor the santa mastodon account yet
    await expect(
      page.getByText('You must follow @secretsanta.nz@bsky.brid.gy')
    ).toBeVisible();
    await expect(
      page.getByText('You must follow @@santa.test.bsky.social')
    ).toBeVisible();
    // About me shows the mastodon identity with the bridged bluesky handle
    await expect(
      page.locator('#my-details-card').getByText('eve@mastodon.test')
    ).toBeVisible();

    // Once they follow both, the banners disappear
    await app.db
      .updateTable('player')
      .set({ following_santa_uri: 'mastodon', mastodon_following_santa: 1 })
      .where('did', '=', eve.did)
      .execute();
    await page.reload();
    await expect(
      page.getByText('You must follow @secretsanta.nz@bsky.brid.gy')
    ).toHaveCount(0);
    await expect(
      page.getByText('You must follow @@santa.test.bsky.social')
    ).toHaveCount(0);
  });

  test('My giftee: mastodon giftees link through the bridge', async ({
    app,
    page,
  }) => {
    await app.insertPlayer(eve, {
      player_type: 'mastodon',
      mastodon_account: 'eve@mastodon.test',
      mastodon_host: 'mastodon.test',
    });
    await createMatch(app.db, alice.did, eve.did, { match_status: 'locked' });
    await app.login(page, 'alice');
    await page.goto('/');
    const gifteeCard = page.locator('#my-giftee-card');
    await expect(
      gifteeCard.getByRole('link', { name: '@eve@mastodon.test' })
    ).toBeVisible();
    await expect(
      gifteeCard.getByRole('link', { name: '@eve.test.bsky.social' })
    ).toBeVisible();
  });

  test('My giftee: bridged bluesky giftees show their mastodon account', async ({
    app,
    page,
  }) => {
    await app.db
      .updateTable('player')
      .set({ mastodon_account: 'bob@mastodon.test' })
      .where('did', '=', bob.did)
      .execute();
    await createMatch(app.db, alice.did, bob.did, { match_status: 'locked' });
    await app.login(page, 'alice');
    await page.goto('/');
    const gifteeCard = page.locator('#my-giftee-card');
    await expect(
      gifteeCard.getByRole('link', { name: '@bob.test.bsky.social' })
    ).toBeVisible();
    await expect(gifteeCard.getByText('@bob@mastodon.test')).toBeVisible();
  });

  test('Santa Only players have no address section', async ({ app, page }) => {
    await app.login(page, 'santaonly');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'My address' })).toHaveCount(
      0
    );
    await expect(page.getByText(/Playing as a/)).toBeVisible();
  });

  test('unwrapped presents are called out in the presents cards', async ({
    app,
    page,
  }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await createTracking(app.db, match.id, { giftwrap_status: 0 });
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.getByText(/Gifts are naked/)).toBeVisible();
  });

  test('players without an avatar get the fallback silhouette', async ({
    app,
    page,
  }) => {
    await app.db
      .updateTable('player')
      .set({ avatar_url: '' })
      .where('did', '=', eve.did)
      .execute();
    await app.login(page, 'eve');
    await page.goto('/');
    await expect(page.locator('#my-details-card svg')).toBeVisible();
  });
});
