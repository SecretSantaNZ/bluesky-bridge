import { test, expect, submitAndWait } from './fixtures.js';
import { setSettings, createMatch } from './helpers/state.js';
import { slowpoke, alice, bob } from './helpers/users.js';

test.describe('onboarding', () => {
  test('player without address is funneled through the address form then game mode', async ({
    app,
    page,
  }) => {
    await app.login(page, 'slowpoke');
    await page.goto('/');

    // Forced /address screen; no Google Places key in e2e, the address input
    // stays hidden until manual entry is selected
    await expect(
      page.getByRole('button', { name: "I can't find my address" })
    ).toBeVisible();
    await page.getByRole('button', { name: "I can't find my address" }).click();
    await page
      .locator('input[name=address]')
      .fill('123 Slowpoke Street, Wellington, New Zealand');
    await page.locator('#delivery_instructions').fill('Ring the buzzer twice');
    await submitAndWait(page, '/address', () =>
      page.locator('#modal-content input[type=submit]').click()
    );

    // Back to home, but now forced through game-mode
    await expect(page.locator('#game_mode')).toBeVisible();
    await page.locator('#game_mode').selectOption({ label: 'Super Santa' });
    await page.locator('#max_giftees').fill('3');
    await submitAndWait(page, '/game-mode', () =>
      page.locator('#modal-content input[type=submit]').click()
    );

    // Home now shows address + game mode
    await expect(page.locator('#player-home')).toBeVisible({
      timeout: 10_000,
    });
    const player = await app.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', slowpoke.did)
      .executeTakeFirstOrThrow();
    expect(player.address).toContain('Slowpoke Street');
    expect(player.game_mode).toBe('Super Santa');
    expect(player.max_giftees).toBe(3);
    expect(player.signup_complete).toBe(1);
  });

  test('regular players cannot pick how many giftees', async ({
    app,
    page,
  }) => {
    await app.login(page, 'slowpoke');
    await page.goto('/');
    await page.getByRole('button', { name: "I can't find my address" }).click();
    await page
      .locator('input[name=address]')
      .fill('2 Main St, Auckland, New Zealand');
    await submitAndWait(page, '/address', () =>
      page.locator('#modal-content input[type=submit]').click()
    );

    await expect(page.locator('#game_mode')).toBeVisible();
    await page.locator('#game_mode').selectOption({ label: 'Regular' });
    await expect(page.locator('#max_giftees')).toBeHidden();
    await submitAndWait(page, '/game-mode', () =>
      page.locator('#modal-content input[type=submit]').click()
    );
    const player = await app.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', slowpoke.did)
      .executeTakeFirstOrThrow();
    expect(player.game_mode).toBe('Regular');
    expect(player.max_giftees).toBe(1);
  });

  test('address editing is blocked once the address was released', async ({
    app,
    page,
  }) => {
    // alice is the locked giftee of bob
    const setts = await setSettings(app.db, { signups_open: 0 });
    void setts;
    await createMatch(app.db, bob.did, alice.did, { match_status: 'locked' });
    await app.login(page, 'alice');
    await page.goto('/');

    // no edit pencil shown on the home page
    await expect(page.getByRole('link', { name: 'Edit addreess' })).toHaveCount(
      0
    );

    // and the POST route rejects direct updates
    const response = await page.request.post('/address', {
      form: {
        address: 'somewhere else',
        delivery_instructions: 'no',
      },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.status()).toBe(400);
  });

  test('game mode changes are refused once signups are closed', async ({
    app,
    page,
  }) => {
    await setSettings(app.db, { signups_open: 0 });
    await app.login(page, 'alice');
    // The edit pencil only shows while signups are open
    await page.goto('/');
    await expect(
      page.getByRole('link', { name: 'Edit game mood' })
    ).toHaveCount(0);
    const response = await page.request.post('/game-mode', {
      form: {
        game_mode: 'Super Santa',
        max_giftees: '3',
      },
    });
    expect(response.status()).toBe(400);
  });
});
