import { describe, expect, it } from 'vitest';
import {
  fetchBridgedBlueskyPage,
  fetchBridgedMastodonPage,
  parseBridgedBlueskyHandle,
  parseBridgedMastodonHandle,
} from './bridgyfed.js';

describe('bridgyfed', () => {
  it(
    'maps a bluesky handle to the bridged mastodon handle',
    { timeout: 30000 },
    async () => {
      const html = await fetchBridgedMastodonPage('orthanc.nz');
      expect(html).not.toBeNull();
      expect(parseBridgedMastodonHandle(html!)).toBe('orthanc.nz@bsky.brid.gy');
    }
  );

  it(
    'maps a mastodon handle to the bridged bluesky handle',
    { timeout: 30000 },
    async () => {
      const html = await fetchBridgedBlueskyPage('Orthanc@cloudisland.nz');
      expect(html).not.toBeNull();
      expect(parseBridgedBlueskyHandle(html!)).toBe(
        'Orthanc.cloudisland.nz.ap.brid.gy'
      );
    }
  );

  it('returns null for unbridged accounts', { timeout: 30000 }, async () => {
    await Promise.all([
      expect(
        fetchBridgedMastodonPage('nonexistent.example')
      ).resolves.toBeNull(),
      expect(
        fetchBridgedBlueskyPage('nonexistent@example.com')
      ).resolves.toBeNull(),
    ]);
  });
});
