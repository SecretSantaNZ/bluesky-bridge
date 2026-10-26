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
 * The "players available to santa" sidebar rows are ordered randomly on
 * every render (loadPlayersWhoCanHaveMoreGifees breaks ties with
 * random()), and at narrow widths long handles wrap differently depending
 * on where they land. Hide the rows for snapshot stability; the heading,
 * row count and overflow text remain.
 */
export const hideRandomOrderRows = async (page: Page) => {
  await page.addStyleTag({
    content: '.players-available-row { display: none !important; }',
  });
};

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
