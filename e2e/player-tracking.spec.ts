import { test, expect, submitAndWait } from './fixtures.js';
import {
  createMatch,
  createTracking,
  createBadge,
  setSettings,
} from './helpers/state.js';
import { alice, bob } from './helpers/users.js';

test.describe('player tracking', () => {
  test('add tracking for a giftee and see the sent-present badge', async ({
    app,
    page,
  }) => {
    const badge = await createBadge(app.db, 'Sent a Present');
    await setSettings(app.db, {
      sent_present_badge_id: badge.id,
      show_badges: 1,
    });
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });

    await app.login(page, 'alice');
    await page.goto('/');
    await page
      .locator('#my-giftee-card')
      .getByRole('link', { name: 'Add sent present' })
      .click();

    const modal = page.locator('#modal-content');
    await expect(modal.getByText('Date shipped')).toBeVisible();
    // shipped date defaults to today
    const shippedValue = await modal.locator('#shipped_date').inputValue();
    expect(shippedValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await modal.locator('#carrier').selectOption({ index: 0 });
    await modal.locator('#tracking_number').fill('NZTRACK001');
    await modal.locator('#giftwrap_status_wrapped').check();
    await submitAndWait(page, `/tracking`, () =>
      modal.locator('input[type=submit]').click()
    );

    // The redirect goes to the sent-present badge modal
    await expect(
      page.getByRole('heading', { name: 'Sent a Present' })
    ).toBeVisible({ timeout: 10_000 });

    // Tracking was written and the match has a present
    const trackingRows = await app.db
      .selectFrom('tracking')
      .selectAll()
      .where('match', '=', match.id)
      .execute();
    expect(trackingRows).toHaveLength(1);
    expect(trackingRows[0]!.tracking_number).toBe('NZTRACK001');
    expect(trackingRows[0]!.giftwrap_status).toBe(1);
    expect(trackingRows[0]!.tracking_status).toBe('queued');
  });

  test('giftee can report a missing present', async ({ app, page }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await createTracking(app.db, match.id, { tracking_status: 'sent' });

    await app.login(page, 'bob');
    await page.goto('/');
    await expect(page.getByText('1 gift', { exact: false })).toBeVisible();
    await submitAndWait(page, `/tracking`, () =>
      page.getByRole('button', { name: 'Report missing' }).click()
    );

    const { missing } = await app.db
      .selectFrom('tracking')
      .select('missing')
      .where('match', '=', match.id)
      .executeTakeFirstOrThrow();
    expect(missing).not.toBeNull();
    await expect(
      page.getByRole('button', { name: 'Report arrived' })
    ).toBeVisible();
  });

  test('giftee can report a missing present as arrived', async ({
    app,
    page,
  }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await createTracking(app.db, match.id, {
      tracking_status: 'sent',
      missing: new Date().toISOString(),
    });

    await app.login(page, 'bob');
    await page.goto('/');
    await submitAndWait(page, `/tracking`, () =>
      page
        .locator('#tracking-details-1, [id^=tracking-details-]')
        .first()
        .getByRole('button', { name: 'Report arrived' })
        .click()
    );
    await page.reload();

    const { missing } = await app.db
      .selectFrom('tracking')
      .select('missing')
      .where('match', '=', match.id)
      .executeTakeFirstOrThrow();
    expect(missing).toBeNull();
  });
});
