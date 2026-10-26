import { test, expect } from './fixtures.js';

test.describe('admin access', () => {
  test('non-admins are redirected away from /admin', async ({ app, page }) => {
    await app.login(page, 'alice');
    await page.goto('/admin/settings');
    // Redirected back to the player home
    await expect(page.locator('#player-home')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Elf tools' })).toHaveCount(0);
  });

  test('elf navigation and home dashboard', async ({ app, page }) => {
    await app.login(page, 'headelf');
    await page.goto('/admin');
    await expect(
      page.getByRole('heading', { name: 'Players', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Draft matches' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Fix matches' })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Manage players' })
    ).toBeVisible();
    await page.getByRole('link', { name: 'Elf tools' }).first().click();
    await expect(
      page.getByRole('heading', { name: 'Players', exact: true })
    ).toBeVisible();
  });
});
