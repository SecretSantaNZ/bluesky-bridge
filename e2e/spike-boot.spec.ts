import { test, expect } from './fixtures.js';

test('smoke: app boots and player home renders', async ({ page, app }) => {
  await app.login(page, 'headelf');
  await page.goto('/');
  await expect(page.getByText('Elf tools')).toBeVisible();
});
