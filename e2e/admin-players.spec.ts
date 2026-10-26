import { test, expect, submitAndWait, type AppHandle } from './fixtures.js';
import { defaultSettings, setSettings } from './helpers/state.js';
import { alice, bob, carol, natter, slowpoke } from './helpers/users.js';

test.describe('admin players', () => {
  test.beforeEach(async ({ app }) => {
    await setSettings(app.db, defaultSettings());
  });

  test('manage players lists and filters by handle', async ({ app, page }) => {
    await app.login(page, 'headelf');
    await page.goto('/admin/manage-players');
    await expect(page.getByText(/alice\.test\.bsky\.social/)).toBeVisible();
    await page
      .locator('input[placeholder="coolplayer.bsky.social"]')
      .first()
      .fill('bob');
    await expect(page.getByText(/bob\.test\.bsky\.social/)).toBeVisible();
    await expect(page.getByText(/alice\.test\.bsky\.social/)).toBeHidden();
  });

  test('boot, list as deactivated, and restore a player', async ({
    app,
    page,
  }) => {
    await app.login(page, 'headelf');
    await page.goto('/admin/manage-players');

    // Boot carol: click the trash icon, then confirm
    const carolBootId = await playerId(app, carol);
    await page
      .locator(`form[action="/admin/player/${carolBootId}/boot"]`)
      .getByRole('button')
      .first()
      .click();
    const carolId = await playerId(app, carol);
    await submitAndWait(page, '/boot', () =>
      page
        .locator(`form[action="/admin/player/${carolId}/boot"]`)
        .locator('input[type=submit][value="Boot player"]')
        .click()
    );

    const carolRow = await app.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', carol.did)
      .executeTakeFirstOrThrow();
    expect(carolRow.booted).not.toBeNull();
    expect(carolRow.booted_by).toContain('headelf');

    // Deactivated section shows carol, restore works
    await expect(page.getByText(/carol\.test\.bsky\.social/)).toBeVisible();
    await page.reload();
    const carolIdForRestore = await playerId(app, carol);
    await page
      .locator(`form[action="/admin/player/${carolIdForRestore}/restore"]`)
      .getByRole('button')
      .first()
      .click();
    await submitAndWait(page, '/restore', () =>
      page
        .locator(`form[action="/admin/player/${carolIdForRestore}/restore"]`)
        .locator('input[type=submit][value="Restore player"]')
        .click()
    );
    const restored = await app.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', carol.did)
      .executeTakeFirstOrThrow();
    expect(restored.booted).toBeNull();
  });

  test('boot with opt-out instead opts the player out', async ({
    app,
    page,
  }) => {
    await app.login(page, 'headelf');
    await page.goto('/admin/manage-players');
    const id = await playerId(app, carol);
    await page
      .locator(`form[action="/admin/player/${id}/boot"]`)
      .getByRole('button')
      .first()
      .click();
    await submitAndWait(page, `/player/${id}/boot`, () =>
      page
        .locator(`form[action="/admin/player/${id}/boot"]`)
        .locator('input[type=submit][value="Opt out"]')
        .click()
    );

    const carolRow = await app.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', carol.did)
      .executeTakeFirstOrThrow();
    expect(carolRow.opted_out).not.toBeNull();
    expect(carolRow.booted).toBeNull();
  });

  test('elf notes on a player', async ({ app, page }) => {
    await app.login(page, 'headelf');
    await page.goto(`/admin/player/${await playerId(app, alice)}/notes`);

    await page.locator('#add-note-text').fill('Sent nudge DMs twice');
    await submitAndWait(page, `/notes`, () =>
      page.locator('form#add-note input[type=submit]').click()
    );

    const notes = await app.db
      .selectFrom('note')
      .selectAll()
      .where('player_did', '=', alice.did)
      .execute();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toBe('Sent nudge DMs twice');
    expect(notes[0]!.author).toContain('headelf');

    // delete the note again (two-step confirm, then submit)
    await page
      .locator(`form#delete-note${notes[0]!.id}`)
      .getByRole('button')
      .first()
      .click();
    await submitAndWait(page, `/_delete`, () =>
      page
        .locator(`form#delete-note${notes[0]!.id}`)
        .locator('input[type=submit][value="Delete note"]')
        .click()
    );
    expect(
      await app.db
        .selectFrom('note')
        .selectAll()
        .where('player_did', '=', alice.did)
        .execute()
    ).toHaveLength(0);
  });

  test('game-mode can be forced to Giftee Only by an elf', async ({
    app,
    page,
  }) => {
    await app.login(page, 'headelf');
    await page.goto(`/admin/player/${await playerId(app, slowpoke)}/game-mode`);
    await page.locator('#game_mode').selectOption({ label: 'Giftee Only' });
    await submitAndWait(page, `/game-mode`, () =>
      page.locator('form#modal-content input[type=submit]').click()
    );
    const row = await app.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', slowpoke.did)
      .executeTakeFirstOrThrow();
    expect(row.game_mode).toBe('Giftee Only');
    expect(row.max_giftees).toBe(0);
  });

  test('retry DMs for a player with DMs disabled', async ({ app, page }) => {
    await app.login(page, 'headelf');
    await page.goto('/admin/manage-players');
    await page
      .locator(
        `form[action="/admin/player/${await playerId(app, natter)}/retry-dm"] button`
      )
      .first()
      .click();
  });

  test('refresh-following re-checks the santa relationship', async ({
    app,
    page,
  }) => {
    await app.login(page, 'headelf');
    await page.goto('/admin/manage-players');
    await page
      .locator(
        `form[action="/admin/player/${await playerId(app, alice)}/refresh-following"] button`
      )
      .first()
      .click();
    const row = await app.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', alice.did)
      .executeTakeFirstOrThrow();
    expect(row.following_santa_uri).not.toBeNull();
  });

  test('assign a santa to a lone player', async ({ app, page }) => {
    // slowpoke needs a santa
    await app.login(page, 'headelf');
    await page.goto(
      `/admin/player/${await playerId(app, slowpoke)}/assign-santa`
    );
    await page.locator('#assign_santa_santa_handle').fill(bob.handle);
    await submitAndWait(page, `assign-santa`, () =>
      page.locator('form#modal-content input[type=submit]').click()
    );
    const match = await app.db
      .selectFrom('match')
      .selectAll()
      .where('deactivated', 'is', null)
      .execute();
    expect(match).toHaveLength(1);
    expect(match[0]!.match_status).toBe('draft');
  });
});

const playerId = async (app: AppHandle, user: { did: string }) => {
  const row = await app.db
    .selectFrom('player')
    .select('id')
    .where('did', '=', user.did)
    .executeTakeFirstOrThrow();
  return row.id;
};
