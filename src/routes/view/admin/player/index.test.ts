import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createDb, migrateToLatest } from '../../../../lib/database/index.js';
import { createAdminPlayer, type CreatePlayerInput } from './index.js';
import { PlayerService } from '../../../../lib/PlayerService.js';
import type { Agent } from '@atproto/api';
import type { DmSender } from '../../../../lib/DmSender.js';
import { BadRequestError } from 'http-errors-enhanced';

const resolveMastodonHandle = vi.hoisted(() => vi.fn());
vi.mock('../../../mastodon/index.js', () => ({
  resolveMastodonHandle,
  mastodon: vi.fn(),
}));

// getLocation talks to google places
vi.mock('../../../../lib/googlePlaces.js', () => ({
  getLocation: vi.fn(async () => null),
}));

const newrelicMock = vi.hoisted(() => ({
  recordCustomEvent: vi.fn(),
  noticeError: vi.fn(),
}));

vi.mock('newrelic', () => ({
  default: newrelicMock,
  ...newrelicMock,
}));

vi.mock('../../../../bluesky.js', () => ({
  unauthenticatedAgent: {
    resolveHandle: vi.fn(),
    getProfile: vi.fn().mockResolvedValue({
      data: {
        did: 'did:plc:user',
        handle: 'user.bsky.social',
        avatar: null,
        postsCount: 0,
        labels: [],
        associated: { chat: { allowIncoming: 'all' } },
      },
    } as never),
    getProfiles: vi.fn(),
  },
}));

vi.mock('../../../../lib/bluesky.js', () => ({
  fetchRelationships: vi.fn().mockResolvedValue({ relationships: [] }),
}));

vi.mock('../../../../lib/webhooks.js', () => ({
  postWebhook: vi.fn(),
}));

vi.mock('../../../../lib/mastodon.js', () => ({
  fetchMastodonRelationships: vi.fn().mockResolvedValue([]),
  lookupMastodonAccount: vi.fn().mockResolvedValue({ id: '1' }),
  followMastodonAccount: vi.fn(),
}));

vi.mock('../../../../lib/bridgyfed.js', () => ({
  fetchBridgedMastodonPage: vi.fn().mockResolvedValue(null),
  fetchBridgedBlueskyPage: vi.fn().mockResolvedValue(null),
  parseBridgedMastodonHandle: vi.fn(),
  parseBridgedBlueskyHandle: vi.fn(),
}));

const santaAgent = vi.fn(
  async () =>
    ({
      resolveHandle: vi.fn(async ({ handle }: { handle: string }) => ({
        data: { did: `did:plc:resolved-${handle}` },
      })),
    }) as unknown as Agent
);

async function buildBridge() {
  const db = createDb();
  await migrateToLatest(db);
  process.env.FOLLOWING_CHANGED_WEBHOOK = 'https://example.com/f';
  process.env.HANDLE_CHANGED_WEBHOOK = 'https://example.com/h';
  process.env.OPTED_OUT_WEBHOOK = 'https://example.com/o';
  const dmSender = {
    sendDm: vi.fn().mockResolvedValue(undefined),
  } as unknown as DmSender;
  const playerService = new PlayerService(
    db,
    santaAgent,
    'did:plc:santa',
    dmSender,
    new Set(),
    'santa@mastodon.social',
    'mastodon.social'
  );
  return { db, playerService, santaAgent };
}

const input = (over: Partial<CreatePlayerInput> = {}): CreatePlayerInput => ({
  player_type: 'bluesky',
  handle: 'new-player.bsky.social',
  address: '',
  delivery_instructions: '',
  ...over,
});

describe('createAdminPlayer', () => {
  beforeEach(async () => {
    resolveMastodonHandle.mockReset();
  });

  afterEach(() => {
    delete process.env.FOLLOWING_CHANGED_WEBHOOK;
    delete process.env.HANDLE_CHANGED_WEBHOOK;
    delete process.env.OPTED_OUT_WEBHOOK;
  });

  it('creates a bluesky player from a handle with Regular defaults', async () => {
    const bridge = await buildBridge();
    const adminPlayer = await createAdminPlayer(bridge, input());
    const stored = await bridge.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', 'did:plc:resolved-new-player.bsky.social')
      .executeTakeFirst();
    expect(stored).toBeDefined();
    expect(adminPlayer).toMatchObject({
      did: 'did:plc:resolved-new-player.bsky.social',
    });
    const row = await bridge.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', stored!.did)
      .executeTakeFirstOrThrow();
    expect(row.game_mode).toBe('Regular');
    expect(row.max_giftees).toBe(1);
  });

  it('rejects a bluesky handle that is a bridgy fed mastodon account', async () => {
    const bridge = await buildBridge();
    await expect(
      createAdminPlayer(
        bridge,
        input({ handle: 'user.mastodon.host.ap.brid.gy' })
      )
    ).rejects.toThrow(BadRequestError);
  });

  it('stores mastodon attributes resolved through bridgy fed', async () => {
    const bridge = await buildBridge();
    resolveMastodonHandle.mockResolvedValue({
      handle: 'user@instance.social',
      host: 'instance.social',
    });
    const lookupBridged = await bridge.playerService.lookupBridgedBlueskyHandle(
      'user@instance.social'
    );
    expect(lookupBridged).toBeNull();

    await expect(
      createAdminPlayer(
        bridge,
        input({ player_type: 'mastodon', handle: 'user@instance.social' })
      )
    ).rejects.toThrow(
      'Unable to find Bluesky handle for account user@instance.social'
    );
  });

  it('geocodes provided addresses', async () => {
    const google = await import('../../../../lib/googlePlaces.js');
    vi.mocked(google.getLocation).mockResolvedValueOnce({
      lat: -41,
      lng: 174,
    } as never);
    const bridge = await buildBridge();
    await createAdminPlayer(bridge, input({ address: '12 Queen St' }));
    const row = await bridge.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', 'did:plc:resolved-new-player.bsky.social')
      .executeTakeFirstOrThrow();
    expect(JSON.parse(row.address_location!)).toEqual({ lat: -41, lng: 174 });
  });
});
