import { test, expect, submitAndWait } from './fixtures.js';
import {
  bootPlayer,
  createMatch,
  defaultSettings,
  setSettings,
} from './helpers/state.js';
import type { AppHandle } from './fixtures.js';
import { insertPlayerRow } from './helpers/users.js';
import {
  alice,
  bob,
  carol,
  dave,
  eve,
  gifteeonly,
  slowpoke,
  supersanta,
} from './helpers/users.js';

const playerId = async (app: AppHandle, user: { did: string }) => {
  const row = await app.db
    .selectFrom('player')
    .select('id')
    .where('did', '=', user.did)
    .executeTakeFirstOrThrow();
  return row.id;
};

/** Extra eligible players, e.g. to push lists past their 15-item overflow. */
const seedExtraPlayers = async (
  app: AppHandle,
  count: number,
  prefix: string
) => {
  for (let i = 1; i <= count; i++) {
    await insertPlayerRow(app.db, {
      key: `${prefix}${i}`,
      handle: `${prefix}${i}.test.bsky.social`,
      did: `did:plc:e2e${prefix}${i}`,
      game_mode: 'Regular',
      max_giftees: 2,
      address: `${prefix}${i} Street 1, Wellington`,
      delivery_instructions: null,
      admin: 0,
    });
  }
};

test.describe('admin matches', () => {
  test.beforeEach(async ({ app }) => {
    await setSettings(app.db, defaultSettings());
  });

  test('draft matches page lists draft matches', async ({ app, page }) => {
    await createMatch(app.db, alice.did, bob.did, { match_status: 'draft' });
    await app.login(page, 'headelf');
    await page.goto('/admin/draft-matches');
    await expect(
      page.getByRole('heading', { name: 'Draft matches' }).first()
    ).toBeVisible();
    await expect(
      page.locator('#my-giftee-card, body').getByText(/bob\.test\.bsky\.social/)
    ).toBeVisible();
  });

  test('auto-match creates a chain from >= 5 players', async ({
    app,
    page,
  }) => {
    await app.login(page, 'headelf');
    await page.goto('/admin/draft-matches');
    // the five seeded players are eligible (low post counts)
    await submitAndWait(page, '/admin/match/auto-match', () =>
      page.locator('#auto-match button[type=submit]').click()
    );
    const matches = await app.db
      .selectFrom('match')
      .selectAll()
      .where('deactivated', 'is', null)
      .execute();
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.every((m) => m.match_status === 'draft')).toBe(true);
  });

  test('publish drafts to shared, then to locked', async ({ app, page }) => {
    await createMatch(app.db, alice.did, bob.did, { match_status: 'draft' });
    await app.login(page, 'headelf');
    await page.goto('/admin/draft-matches');
    await submitAndWait(page, '/admin/match/publish', () =>
      page.locator('form#publish-to-shared button[type=submit]').first().click()
    );

    const rows = await app.db
      .selectFrom('match')
      .selectAll()
      .where('deactivated', 'is', null)
      .executeTakeFirstOrThrow();
    expect(rows.match_status).toBe('shared');

    // Draft list is empty, published list shows the match
    await page.goto('/admin/published-matches');
    await expect(page.getByText(/bob\.test\.bsky\.social/)).toBeVisible();

    // Publish further to locked so the address releases
    await submitAndWait(page, '/admin/match/publish', () =>
      page.locator('form#publish-to-shared button[type=submit]').first().click()
    );
    const locked = await app.db
      .selectFrom('match')
      .selectAll()
      .where('deactivated', 'is', null)
      .executeTakeFirstOrThrow();
    expect(locked.match_status).toBe('locked');
  });

  test('publish with address locks matches and releases addresses', async ({
    app,
    page,
  }) => {
    await createMatch(app.db, alice.did, bob.did, { match_status: 'draft' });
    await app.login(page, 'headelf');
    await page.goto('/admin/draft-matches');
    await submitAndWait(page, '/admin/match/publish', () =>
      page.locator('form#publish-to-locked button[type=submit]').first().click()
    );
    const row = await app.db
      .selectFrom('match')
      .selectAll()
      .where('deactivated', 'is', null)
      .executeTakeFirstOrThrow();
    expect(row.match_status).toBe('locked');
    // bob is the giftee: his address is now locked in
    const bobRow = await app.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', bob.did)
      .executeTakeFirstOrThrow();
    expect(bobRow.locked_giftee_for_count).toBe(1);
  });

  test('delete drafts', async ({ app, page }) => {
    await createMatch(app.db, alice.did, bob.did, { match_status: 'draft' });
    await app.login(page, 'headelf');
    await page.goto('/admin/draft-matches');
    page.on('dialog', (d) => d.accept());
    await submitAndWait(page, '/admin/match/delete-drafts', () =>
      page.locator('form#delete-draft-matches button[type=submit]').click()
    );
    expect(await app.db.selectFrom('match').selectAll().execute()).toHaveLength(
      0
    );
  });

  test('deactivate a single match from the list', async ({ app, page }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'draft',
    });
    await app.login(page, 'headelf');
    await page.goto('/admin/draft-matches');
    await page
      .locator(`form[action="/admin/match/${match.id}/deactivate"]`)
      .getByRole('button')
      .first()
      .click();
    await submitAndWait(page, `/deactivate`, () =>
      page
        .locator(`form[action="/admin/match/${match.id}/deactivate"]`)
        .locator('input[type=submit][value="Delete match"]')
        .click()
    );
    await page.reload();
    expect(
      await app.db
        .selectFrom('match')
        .selectAll()
        .where('id', '=', match.id)
        .executeTakeFirstOrThrow()
        .then((r) => r.deactivated)
    ).not.toBeNull();
  });

  test('fix-matches: too many giftees flagged, reassign via modal', async ({
    app,
    page,
  }) => {
    // supersanta limited to one giftee but holding two = too_many
    await setSettings(app.db, { ...defaultSettings(), signups_open: 1 });
    await app.insertPlayer(supersanta, {
      game_mode: 'Regular', // game_mode Regular wants exactly one giftee
    });
    await createMatch(app.db, supersanta.did, alice.did, {
      match_status: 'shared',
    });
    await createMatch(app.db, supersanta.did, bob.did, {
      match_status: 'shared',
    });

    await app.login(page, 'headelf');
    await page.goto('/admin/fix-matches');
    await expect(
      page.getByRole('heading', { name: 'Players with multiple giftees' })
    ).toBeVisible();

    // reassign bob's santa to eve via the reassign modal
    const matchRow = await app.db
      .selectFrom('match')
      .selectAll()
      .innerJoin('player as santa', 'santa.id', 'match.santa')
      .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
      .select('match.id as id')
      .where('santa.did', '=', supersanta.did)
      .where('giftee.did', '=', bob.did)
      .executeTakeFirstOrThrow();

    await page.goto(`/admin/match/${matchRow.id}/reassign`);
    await page.locator('#reassign_giftee_santa_handle').fill(dave.handle);
    await submitAndWait(page, `/match/${matchRow.id}/reassign`, () =>
      page.locator('form#modal-content input[type=submit]').click()
    );

    const fixed = await app.db
      .selectFrom('match')
      .selectAll()
      .innerJoin('player as santa', 'santa.id', 'match.santa')
      .where('match.giftee', '=', await playerId(app, bob))
      .where('match.deactivated', 'is', null)
      .select('santa.did as santa_did')
      .executeTakeFirst();
    expect(fixed?.santa_did).toBe(dave.did);
  });

  test('fix-matches: players needing a santa are listed and linkable', async ({
    app,
    page,
  }) => {
    void slowpoke;
    void gifteeonly;
    void alice;
    void eve;
    await app.login(page, 'headelf');
    await page.goto('/admin/fix-matches');
    await expect(
      page.getByRole('heading', { name: 'Players needing a Santa' })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Assign santa' }).first()
    ).toBeVisible();
  });

  test('reassign modal from fix-matches', async ({ app, page }) => {
    const match = await createMatch(app.db, bob.did, alice.did, {
      match_status: 'shared',
    });
    await app.login(page, 'headelf');
    await page.goto(`/admin/match/${match.id}/reassign`);
    await expect(page.getByText(/Reassign/i)).toBeVisible();
  });

  test('fix-matches: broken matches from deactivated players are listed', async ({
    app,
    page,
  }) => {
    await createMatch(app.db, alice.did, bob.did, { match_status: 'locked' });
    // Booting the giftee deactivates the player, which flags the match broken
    await bootPlayer(app.db, bob.did);
    await app.login(page, 'headelf');
    await page.goto('/admin/fix-matches');
    await expect(
      page.getByRole('heading', { name: 'Broken matches' })
    ).toBeVisible();
    await expect(
      page.getByText(/alice\.test\.bsky\.social/).first()
    ).toBeVisible();
  });

  test('fix-matches: players with too many Giftees are flagged', async ({
    app,
    page,
  }) => {
    // supersanta limited to one giftee but holding two = giftee_count_status
    // 'too_many' (critical), listed with links to fix it
    await app.insertPlayer(supersanta, {
      game_mode: 'Regular',
      max_giftees: 1,
    });
    await createMatch(app.db, supersanta.did, alice.did, {
      match_status: 'shared',
    });
    await createMatch(app.db, supersanta.did, bob.did, {
      match_status: 'shared',
    });
    await app.login(page, 'headelf');
    await page.goto('/admin/fix-matches');
    await expect(
      page.getByRole('heading', { name: 'Players with too many Giftees' })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Change game mode' }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Reassign giftee' }).first()
    ).toBeVisible();
  });

  test('fix-matches: players with multiple santas are flagged', async ({
    app,
    page,
  }) => {
    await createMatch(app.db, alice.did, bob.did, { match_status: 'locked' });
    await createMatch(app.db, carol.did, bob.did, { match_status: 'locked' });
    await app.login(page, 'headelf');
    await page.goto('/admin/fix-matches');
    await expect(
      page.getByRole('heading', { name: 'Players with multiple santas' })
    ).toBeVisible();
    await expect(
      page.getByText(/bob\.test\.bsky\.social/).first()
    ).toBeVisible();
  });

  test('fix-matches: long lists collapse into a "+N more" overflow', async ({
    app,
    page,
  }) => {
    // The "needing a santa" list and the "players available to santa"
    // sidebar both render only 15 rows, plus an overflow count beyond that
    await seedExtraPlayers(app, 8, 'gen');
    await app.login(page, 'headelf');
    await page.goto('/admin/fix-matches');

    const needingSanta = await app.db
      .selectFrom('player')
      .select(({ fn }) => fn.countAll<number>().as('cnt'))
      .where('signup_complete', '=', 1)
      .where('giftee_for_count', '=', 0)
      .where('game_mode', '<>', 'Santa Only')
      .executeTakeFirstOrThrow();
    const available = await app.db
      .selectFrom('player')
      .select(({ fn }) => fn.countAll<number>().as('cnt'))
      .where('giftee_count_status', '=', 'can_have_more')
      .where('signup_complete', '=', 1)
      .executeTakeFirstOrThrow();
    expect(needingSanta.cnt).toBeGreaterThan(15);
    expect(available.cnt).toBeGreaterThan(15);

    await expect(
      page.getByText(`... and ${needingSanta.cnt - 15} more`).first()
    ).toBeVisible();
    await expect(
      page.getByText(`... and ${available.cnt - 15} more`).first()
    ).toBeVisible();
  });

  test('fix-matches: reassign surfaces santa-not-found in the modal', async ({
    app,
    page,
  }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'shared',
    });
    await app.login(page, 'headelf');
    await page.goto(`/admin/match/${match.id}/reassign`);
    await page
      .locator('#reassign_giftee_santa_handle')
      .fill('ghost.test.bsky.social');
    // The 409 re-renders the modal content with the inline error
    await page.locator('form#modal-content input[type=submit]').click();
    await expect(
      page.getByText('Cannot find player ghost.test.bsky.social to assign.')
    ).toBeVisible();
    const unchanged = await app.db
      .selectFrom('match')
      .selectAll()
      .where('id', '=', match.id)
      .executeTakeFirstOrThrow();
    expect(unchanged.deactivated).toBeNull();
  });

  test('fix-matches: reassign warns when the santa has no giftee room', async ({
    app,
    page,
  }) => {
    // bob is already at his two-giftee limit
    await createMatch(app.db, bob.did, carol.did, { match_status: 'locked' });
    await createMatch(app.db, bob.did, dave.did, { match_status: 'locked' });
    const match = await createMatch(app.db, alice.did, eve.did, {
      match_status: 'shared',
    });
    await app.login(page, 'headelf');
    await page.goto(`/admin/match/${match.id}/reassign`);
    await page.locator('#reassign_giftee_santa_handle').fill(bob.handle);
    await page.locator('form#modal-content input[type=submit]').click();
    // Plain red warning for regular (non-super) reassigns
    await expect(page.getByText(/can.t have more giftees/)).toBeVisible();
    const unchanged = await app.db
      .selectFrom('match')
      .selectAll()
      .where('id', '=', match.id)
      .executeTakeFirstOrThrow();
    expect(unchanged.santa).toBe(await playerId(app, alice));
  });

  test('fix-matches: super-santa reassigns can force an overloaded santa', async ({
    app,
    page,
  }) => {
    // bob is already at his two-giftee limit
    await createMatch(app.db, bob.did, carol.did, { match_status: 'locked' });
    await createMatch(app.db, bob.did, dave.did, { match_status: 'locked' });
    const match = await createMatch(app.db, alice.did, eve.did, {
      match_status: 'locked',
      super_santa_match: 1,
    });
    await app.login(page, 'headelf');
    await page.goto(`/admin/match/${match.id}/reassign?super_santa_match=true`);
    await page.locator('#reassign_giftee_santa_handle').fill(bob.handle);
    await page.locator('form#modal-content input[type=submit]').click();
    // The super-santa variant shows the orange warning and offers to force
    await expect(page.getByText('Save again to assign anyway.')).toBeVisible();
    await submitAndWait(page, `/match/${match.id}/reassign`, () =>
      page.locator('form#modal-content input[type=submit]').click()
    );

    const eveId = await playerId(app, eve);
    const newMatch = await app.db
      .selectFrom('match')
      .selectAll()
      .where('giftee', '=', eveId)
      .where('deactivated', 'is', null)
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(newMatch.santa).toBe(await playerId(app, bob));
    expect(newMatch.super_santa_match).toBe(1);
    expect(newMatch.match_status).toBe('locked');
    const oldMatch = await app.db
      .selectFrom('match')
      .selectAll()
      .where('id', '=', match.id)
      .executeTakeFirstOrThrow();
    expect(oldMatch.followup_action).toBe('super-assigned');
  });

  test('fix-matches: changing game mode round-trips back to fix-matches', async ({
    app,
    page,
  }) => {
    await app.insertPlayer(supersanta, {
      game_mode: 'Regular',
      max_giftees: 1,
    });
    await createMatch(app.db, supersanta.did, alice.did, {
      match_status: 'shared',
    });
    await createMatch(app.db, supersanta.did, bob.did, {
      match_status: 'shared',
    });
    await app.login(page, 'headelf');
    await page.goto('/admin/fix-matches');
    await page.getByRole('link', { name: 'Change game mode' }).first().click();
    await expect(
      page.getByRole('heading', {
        name: 'Game mode for @supersanta.test.bsky.social',
      })
    ).toBeVisible();
    await page.locator('#game_mode').selectOption({ label: 'Super Santa' });
    await page.locator('#max_giftees').fill('3');
    await submitAndWait(page, '/game-mode', () =>
      page.locator('form#modal-content input[type=submit]').click()
    );

    // return_to=fix-matches redirects here, where the issue is now resolved
    await expect(
      page.getByRole('heading', { name: 'Players with too many Giftees' })
    ).toHaveCount(0);
    const row = await app.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', supersanta.did)
      .executeTakeFirstOrThrow();
    expect(row.game_mode).toBe('Super Santa');
    expect(row.max_giftees).toBe(3);
  });
});
