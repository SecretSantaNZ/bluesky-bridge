import { test, expect } from './fixtures.js';
import {
  createMatch,
  createTracking,
  seedOpeningPost,
  setSettings,
  defaultSettings,
} from './helpers/state.js';
import { alice, bob } from './helpers/users.js';
import { expect as pwExpect, type Page } from '@playwright/test';

test.describe('admin ops', () => {
  test.beforeEach(async ({ app }) => {
    await setSettings(app.db, defaultSettings());
  });

  test('published matches page: nudge and tracking on behalf of a match', async ({
    app,
    page,
  }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await app.login(page, 'headelf');
    await page.goto(`/admin/match/${match.id}/nudges`);

    const { id: typeId } = await app.db
      .selectFrom('nudge_type')
      .select('id')
      .where('name', '=', 'Hint')
      .executeTakeFirstOrThrow();
    await page.locator('#nudge_type').selectOption(String(typeId));
    await submitAndWaitOr(page, `/nudges`, () =>
      page
        .locator(
          'form#modal-content input[type=submit], form input[type=submit]'
        )
        .first()
        .click()
    );
    const nudges = await app.db
      .selectFrom('nudge')
      .selectAll()
      .where('match', '=', match.id)
      .execute();
    expect(nudges).toHaveLength(1);
  });

  test('tracking can be added by the elf on behalf of the santa', async ({
    app,
    page,
  }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await app.login(page, 'headelf');
    await page.goto(`/admin/match/${match.id}/tracking`);
    await page.locator('#carrier').selectOption({ index: 0 });
    await page.locator('#shipped_date').fill('2025-12-20');
    await page.locator('#tracking_number').fill('NZELFTRACK');
    await page.locator('#giftwrap_status_wrapped').check();
    await submitAndWaitOr(page, `/tracking`, () =>
      page
        .locator(
          `form[action="/admin/match/${match.id}/tracking"] input[type=submit]`
        )
        .click()
    );
    expect(
      await app.db
        .selectFrom('tracking')
        .selectAll()
        .where('match', '=', match.id)
        .execute()
    ).toHaveLength(1);
  });

  test('people without gifts: mark contacted/sorted and poke inactive santas', async ({
    app,
    page,
  }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await app.login(page, 'headelf');
    await page.goto('/admin/without-gifts');
    await expect(
      page.getByRole('heading', { name: 'People without gifts' })
    ).toBeVisible();
    await expect(
      page
        .locator('#page-body')
        .getByText(/bob\.test\.bsky\.social/)
        .first()
    ).toBeVisible();

    await submitAndWaitOr(page, `/mark-contacted`, () =>
      page
        .locator(
          `form[action="/admin/match/${match.id}/mark-contacted"] button`
        )
        .click()
    );
    await page.reload();
    await submitAndWaitOr(page, `/mark-sorted`, () =>
      page
        .locator(`form[action="/admin/match/${match.id}/mark-sorted"] button`)
        .click()
    );

    const { contacted, followup_action } = await app.db
      .selectFrom('match')
      .select(['contacted', 'followup_action'])
      .where('id', '=', match.id)
      .executeTakeFirstOrThrow();
    expect(contacted).not.toBeNull();
    expect(followup_action).toBe('sorted');
  });

  test('hasnt-posted lists and marks posted openings', async ({
    app,
    page,
  }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await createTracking(app.db, match.id);
    // no opening post yet: bob is giftee with missing posted_opening
    await app.login(page, 'headelf');
    await page.goto('/admin/hasnt-posted');
    await expect(
      page.getByRole('heading', {
        name: "People who haven't posted on opening day",
      })
    ).toBeVisible();

    await page
      .locator(
        `form[action="/admin/match/${match.id}/mark-posted-opening"] button`
      )
      .click();
    await page.reload();
    const { posted_opening } = await app.db
      .selectFrom('match')
      .select('posted_opening')
      .where('id', '=', match.id)
      .executeTakeFirstOrThrow();
    expect(posted_opening).toBe(1);

    // After the opening post exists they are no longer listed
    await seedOpeningPost(app.db, bob.did, 7);
  });

  test('tracking page lists tracking and edits rows', async ({ app, page }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    const tracking = await createTracking(app.db, match.id);
    await app.login(page, 'headelf');
    await page.goto('/admin/tracking');
    await expect(page.getByText('NZ Post')).toBeVisible();
    await page.goto(`/admin/tracking/${tracking.id}`);
    await page.locator('#tracking_number').fill('NZEDITED123');
    await submitAndWaitOr(page, `/admin/tracking/${tracking.id}`, () =>
      page.locator('form#modal-content input[type=submit]').click()
    );
    const row = await app.db
      .selectFrom('tracking')
      .selectAll()
      .where('id', '=', tracking.id)
      .executeTakeFirstOrThrow();
    expect(row.tracking_number).toBe('NZEDITED123');
  });
});

// local helper: wait for the POST triggered by .click()
async function submitAndWaitOr(
  page: Page,
  urlPart: string,
  click: () => Promise<void>
) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(urlPart) && r.request().method() === 'POST'
    ),
    click(),
  ]);
  pwExpect(response.status()).toBeLessThan(400);
}
