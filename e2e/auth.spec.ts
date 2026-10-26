import { test, expect, submitAndWait } from './fixtures.js';
import { setSettings, bootPlayer } from './helpers/state.js';
import { alice } from './helpers/users.js';

test.describe('auth', () => {
  test('unauthenticated users get the login page', async ({ page }) => {
    await page.goto('/');
    // With signups open the login card starts in "choose" mode
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
    await expect(page.getByText('What is Secret Santa NZ?')).toBeVisible();
    await expect(page.getByRole('link', { name: 'The rules' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Frequently asked questions' })
    ).toBeVisible();
  });

  test('choose screen: login mode shows handle and DM code option', async ({
    page,
  }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Login', exact: true })
      .first()
      .click();
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#handle')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Login with DM Code' })
    ).toBeVisible();
  });

  test('choose screen: signup mode shows instructions', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Sign up', exact: true })
      .first()
      .click();
    await expect(page.getByText('To sign up:')).toBeVisible();
    await expect(page.getByText('Enter your handle below')).toBeVisible();
  });

  test('signups closed: handle entry is shown immediately with no signup option', async ({
    app,
    page,
  }) => {
    await setSettings(app.db, { signups_open: 0 });
    await page.goto('/');
    await expect(page.locator('#handle')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign up', exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Login with DM Code' })
    ).toBeVisible();
  });

  test('OTP login flow: code DMd, verified, session cookie issued', async ({
    app,
    page,
  }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Login', exact: true })
      .first()
      .click();
    await page.locator('#handle').fill(alice.handle);
    await page.getByRole('button', { name: 'Login with DM Code' }).click();
    await expect(page.getByText("You've been DMed a 6 digit code")).toBeVisible(
      {
        timeout: 10_000,
      }
    );

    // The OTP code was "sent" via the (stubbed) santa agent and stored in the
    // otp_login table; read it from there instead of a real Bluesky DM.
    const otpRow = await app.db
      .selectFrom('otp_login')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(otpRow.did).toBe(alice.did);
    expect(otpRow.code).toMatch(/^\d{6}$/);

    // The santa agent recorded the outgoing DM attempt
    expect(app.santaAgent.dms.length).toBeGreaterThanOrEqual(1);

    await page.locator('#code').fill(otpRow.code);
    await submitAndWait(page, '/finish-otp-login', () =>
      page.getByRole('button', { name: 'Login' }).last().click()
    );

    await expect(page.locator('#player-home')).toBeVisible({
      timeout: 10_000,
    });
    // Session cookie is now set -- reloading still shows a logged-in page
    await page.goto('/');
    await expect(page.locator('#player-home')).toBeVisible();
  });

  test('OTP login: wrong code eventually expires the key after 3 attempts', async ({
    app,
    page,
  }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Login', exact: true })
      .first()
      .click();
    await page.locator('#handle').fill(alice.handle);
    await page.getByRole('button', { name: 'Login with DM Code' }).click();
    await expect(page.getByText("You've been DMed a 6 digit code")).toBeVisible(
      {
        timeout: 10_000,
      }
    );

    const otpRow = () =>
      app.db.selectFrom('otp_login').selectAll().executeTakeFirstOrThrow();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const { code } = await otpRow();
      const wrongCode = code === '111111' ? '222222' : '111111';
      await page.locator('#code').fill(wrongCode);
      await page.getByRole('button', { name: 'Login' }).last().click();
      await expect(page.getByText('Invalid code')).toBeVisible();
    }

    // After 3 failed attempts the key is dead and the correct code can no
    // longer log in
    const { attempts, code } = await otpRow();
    expect(attempts).toBe(3);
    await page.locator('#code').fill(code);
    await page.getByRole('button', { name: 'Login' }).last().click();
    await expect(page.getByText(/Expired Key|Invalid code/)).toBeVisible();
  });

  test('OTP login refused for a resolvable non-player handle', async ({
    app,
    page,
  }) => {
    // The santa account exists on our fake Bluesky but has no player row.
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Login', exact: true })
      .first()
      .click();
    await page.locator('#handle').fill('santa.test.bsky.social');
    await page.getByRole('button', { name: 'Login with DM Code' }).click();
    await expect(page.getByText('Unknown player')).toBeVisible({
      timeout: 10_000,
    });
    expect(
      await app.db.selectFrom('otp_login').selectAll().execute()
    ).toHaveLength(0);
  });

  test('OTP login refused for player with DMs disabled', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Login', exact: true })
      .first()
      .click();
    await page.locator('#handle').fill('natter.test.bsky.social');
    await page.getByRole('button', { name: 'Login with DM Code' }).click();
    await expect(page.getByText('DMs disabled')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('OTP login refused for a booted player', async ({ app, page }) => {
    await bootPlayer(app.db, alice.did);
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Login', exact: true })
      .first()
      .click();
    await page.locator('#handle').fill(alice.handle);
    await page.getByRole('button', { name: 'Login with DM Code' }).click();
    await expect(page.getByText('Unknown player')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('a booted player with a session sees the deactivated screen', async ({
    app,
    page,
  }) => {
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.locator('#player-home')).toBeVisible();
    await bootPlayer(app.db, alice.did);
    await page.reload();
    await expect(
      page.getByText('You have been removed from the game.')
    ).toBeVisible();
  });

  test('logout clears the session', async ({ app, page }) => {
    await app.login(page, 'alice');
    await page.goto('/');
    await expect(page.locator('#player-home')).toBeVisible();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: 'Logout' }).click();
    // The logout response triggers a page reload sans session cookie
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible({
      timeout: 10_000,
    });
  });
});
