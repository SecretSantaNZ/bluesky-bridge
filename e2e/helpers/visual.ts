import { expect, type Page } from '@playwright/test';

export const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
export const MOBILE_VIEWPORT = { width: 390, height: 844 };

const placeholderSvg = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/></svg>`;

/**
 * External assets (the imgix login banner, the shielded logo, cdn.example.com
 * avatars/badges, the shielded embed script) are aborted by the page fixture's
 * catch-all route. These per-test routes fulfil them with deterministic
 * placeholders instead of broken images. They are registered on the page, so
 * they take precedence over the context-level abort route.
 */
export const servePlaceholderAssets = async (page: Page) => {
  await page.route('https://cdn.example.com/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: placeholderSvg('#94a3b8'),
    })
  );
  await page.route('https://secretsantanz.imgix.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: placeholderSvg('#0ea5e9'),
    })
  );
  await page.route('https://shielded.co.nz/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: placeholderSvg('#f8fafc'),
    })
  );
  await page.route('https://staticcdn.co.nz/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' })
  );
};

/** Prepare a page for snapshotting: placeholder assets + a pinned viewport. */
export const prepareSnapshotPage = async (
  page: Page,
  viewport: { width: number; height: number } = DESKTOP_VIEWPORT
) => {
  await page.setViewportSize(viewport);
  await servePlaceholderAssets(page);
};

/**
 * Locators for regions whose content is rendered relative to the clock
 * (`x-datetime` uses date-fns formatRelative client-side). Pass these to
 * `snapshot()`'s mask option instead of pinning the clock (page.clock's
 * fixed time provably causes 1x1 viewport flickers that flip the app's
 * mobile-width detection mid-capture).
 */
export const datetimeRegions = (page: Page) => page.locator('[x-datetime]');

/** Capture a named snapshot. Waits for Alpine to initialise first (it strips
 *  x-cloak from #page-body) so x-show/x-datetime state is settled. Modals
 *  render as fixed overlays, so pass `{ fullPage: false }` for those. */
export const snapshot = async (
  page: Page,
  name: string,
  options: {
    fullPage?: boolean;
    mask?: Array<ReturnType<Page['locator']>>;
  } = {}
) => {
  await expect(page.locator('#page-body')).not.toHaveAttribute('x-cloak');
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    ...options,
  });
};
