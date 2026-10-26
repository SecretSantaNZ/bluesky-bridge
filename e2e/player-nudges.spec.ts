import { test, expect, submitAndWait } from './fixtures.js';
import type { AppHandle } from './fixtures.js';
import { createMatch, queueNudge } from './helpers/state.js';
import { alice, bob } from './helpers/users.js';

const hintIds = async (app: AppHandle) => {
  const type = await app.db
    .selectFrom('nudge_type')
    .select('id')
    .where('name', '=', 'Hint')
    .executeTakeFirstOrThrow();
  const greeting = await app.db
    .selectFrom('nudge_type_greeting')
    .innerJoin(
      'nudge_greeting',
      'nudge_greeting.id',
      'nudge_type_greeting.greeting'
    )
    .select('nudge_greeting.id as id')
    .where('nudge_type', '=', type.id)
    .orderBy('nudge_greeting.id', 'asc')
    .executeTakeFirstOrThrow();
  const signoff = await app.db
    .selectFrom('nudge_type_signoff')
    .innerJoin(
      'nudge_signoff',
      'nudge_signoff.id',
      'nudge_type_signoff.signoff'
    )
    .select('nudge_signoff.id as id')
    .where('nudge_type', '=', type.id)
    .orderBy('nudge_signoff.id', 'asc')
    .executeTakeFirstOrThrow();
  return { typeId: type.id, greetingId: greeting.id, signoffId: signoff.id };
};

test.describe('player nudges', () => {
  test('send a nudge end to end: queued, posted by the robot, listed', async ({
    app,
    page,
  }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });

    // The route's POST validation derives IDs, so first bookmark real ones.
    const { greetingId, signoffId } = await hintIds(app);

    await app.login(page, 'alice');
    await page.goto('/');
    await page
      .locator('#my-giftee-card')
      .getByRole('link', { name: 'Nudge' })
      .click();

    const modal = page.locator('#modal-content');
    await expect(modal.getByRole('heading')).toBeVisible();

    await modal.locator('#nudge_type').selectOption({ label: 'Hint' });
    await modal.locator('#nudge_greeting').selectOption(String(greetingId));
    await modal.locator('#nudge_signoff').selectOption(String(signoffId));
    await submitAndWait(page, '/nudge', () =>
      modal.locator('input[type=submit]').click()
    );

    // A queued nudge exists for this match
    const nudge = await app.db
      .selectFrom('nudge')
      .selectAll()
      .where('match', '=', match.id)
      .executeTakeFirstOrThrow();
    expect(nudge.nudge_status).toBe('queued');
    expect(nudge.created_by).toBe(alice.did);

    // The nudges list updated
    await expect(page.getByText("You've sent 1 nudge.")).toBeVisible({
      timeout: 10_000,
    });

    // Nothing has reached the robot yet
    expect(app.robotAgent.posts).toHaveLength(0);

    // Send it for real (within the senders' time window)
    await app.withFixedTimeWindow(() => app.nudgeSender.sendANudge());

    expect(app.robotAgent.posts).toHaveLength(1);
    const post = app.robotAgent.posts[0]!;
    expect(post.text).toContain('@bob.test.bsky.social');
    expect(post.text).toContain('[Sent by 🤖]');

    const after = await app.db
      .selectFrom('nudge')
      .selectAll()
      .where('id', '=', nudge.id)
      .executeTakeFirstOrThrow();
    expect(after.nudge_status).toBe('sent');
    expect(after.post_url).toMatch(/^https:\/\/bsky\.app\/profile/);
  });

  test('nudges are capped at 5 per match', async ({ app, page }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    for (let i = 0; i < 5; i++) {
      await queueNudge(app.db, match.id, 'Arrival');
    }

    await app.login(page, 'alice');
    await page.goto('/');
    // The Nudge action disappears once the cap is reached
    await expect(
      page.locator('#my-giftee-card').getByRole('link', { name: 'Nudge' })
    ).toHaveCount(0);

    // And the POST route backs it up
    const type = await app.db
      .selectFrom('nudge_type')
      .select('id')
      .where('name', '=', 'Arrival')
      .executeTakeFirstOrThrow();
    const response = await page.request.post('/nudge', {
      form: {
        nudge_type: String(type.id),
        nudge_greeting: '1',
        nudge_signoff: '1',
        match_id: String(match.id),
      },
    });
    expect(response.status()).toBe(400);
    expect(
      await app.db
        .selectFrom('nudge')
        .selectAll()
        .where('match', '=', match.id)
        .execute()
    ).toHaveLength(5);
  });

  test('queued nudges show up in the admin list', async ({ app, page }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    await queueNudge(app.db, match.id, 'Present Update');
    await app.login(page, 'headelf');
    await page.goto('/admin/nudges');
    await expect(page.getByText(/bob\.test\.bsky\.social/)).toBeVisible();
    await expect(page.getByText('Present Update')).toBeVisible();
  });

  test('admin can delete a queued nudge', async ({ app, page }) => {
    const match = await createMatch(app.db, alice.did, bob.did, {
      match_status: 'locked',
    });
    const nudge = await queueNudge(app.db, match.id, 'Opening');
    await app.login(page, 'headelf');
    await page.goto('/admin/nudges');
    // two-step confirm, then submit
    await page
      .locator(`form[action="/admin/nudges/${nudge.id}/delete"] button`)
      .first()
      .click();
    await submitAndWait(page, `/admin/nudges/${nudge.id}/delete`, () =>
      page
        .locator(`form[action="/admin/nudges/${nudge.id}/delete"]`)
        .locator('input[type=submit][value="Delete nudge"]')
        .click()
    );
    const after = await app.db
      .selectFrom('nudge')
      .selectAll()
      .where('id', '=', nudge.id)
      .execute();
    expect(after).toHaveLength(0);
  });
});
