import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { createDb, migrateToLatest, type Database } from './database/index.js';
import type { DatabaseSchema } from './database/schema.js';
import { PlayerService } from './PlayerService.js';
import { unauthenticatedAgent } from '../bluesky.js';
import { fetchRelationships } from './bluesky.js';
import { postWebhook } from './webhooks.js';
import {
  fetchMastodonRelationships,
  lookupMastodonAccount,
  followMastodonAccount,
} from './mastodon.js';
import {
  fetchBridgedMastodonPage,
  fetchBridgedBlueskyPage,
  parseBridgedMastodonHandle,
  parseBridgedBlueskyHandle,
} from './bridgyfed.js';
import type { Agent } from '@atproto/api';
import type { DmSender } from './DmSender.js';
import type { InsertObject } from 'kysely';

const newrelicMock = vi.hoisted(() => ({
  recordCustomEvent: vi.fn(),
  noticeError: vi.fn(),
}));

vi.mock('newrelic', () => ({
  default: newrelicMock,
  ...newrelicMock,
}));

// The unauthenticated Bluesky agent talks to the public appview, which is an
// external service.
vi.mock('../bluesky.js', () => ({
  unauthenticatedAgent: {
    getProfile: vi.fn(),
    getProfiles: vi.fn(),
  },
}));

// These modules perform all of their work over HTTP against external services
// (public Bluesky api, Mastodon hosts, the Bluesky/Mastodon bridge).
vi.mock('./bluesky.js', () => ({
  fetchRelationships: vi.fn(),
}));

vi.mock('./webhooks.js', () => ({
  postWebhook: vi.fn(),
}));

vi.mock('./mastodon.js', () => ({
  fetchMastodonRelationships: vi.fn(),
  lookupMastodonAccount: vi.fn(),
  followMastodonAccount: vi.fn(),
}));

vi.mock('./bridgyfed.js', () => ({
  fetchBridgedMastodonPage: vi.fn(),
  fetchBridgedBlueskyPage: vi.fn(),
  parseBridgedMastodonHandle: vi.fn(),
  parseBridgedBlueskyHandle: vi.fn(),
}));

const SANTA_DID = 'did:plc:santa';
const SANTA_MASTODON_HANDLE = 'santa@mastodon.social';
const SANTA_MASTODON_HOST = 'mastodon.social';

const relationship = (
  did: string,
  overrides: Partial<{
    followedBy: string | null;
    following: string | null;
  }> = {}
) => ({
  $type: 'app.bsky.graph.defs#relationship',
  did,
  followedBy: null,
  following: null,
  ...overrides,
});

async function setupDb(): Promise<Database> {
  const db = createDb();
  await migrateToLatest(db);
  await db
    .updateTable('settings')
    .set({ auto_follow: 0 })
    .where('id', '=', 0)
    .execute();
  return db;
}

async function insertPlayer(
  db: Database,
  overrides: Partial<InsertObject<DatabaseSchema, 'player'>> = {}
) {
  const did = overrides.did ?? 'did:plc:player';
  return await db
    .insertInto('player')
    .values({
      did,
      handle: 'player.bsky.social',
      player_type: 'bluesky',
      profile_complete: 1,
      signup_complete: 1,
      max_giftees: 3,
      giftee_count: 0,
      giftee_for_count: 0,
      game_mode: 'Regular',
      address: '1 St',
      following_santa_uri: 'at://did:plc:santa/app.bsky.graph.follow/1',
      avatar_url: 'https://example.com/avatar.jpg',
      note_count: 0,
      post_count: 0,
      last_checked_post_count: '2025-12-01T00:00:00.000Z',
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

type PatchUpdates = Parameters<PlayerService['patchPlayer']>[1];

async function insertMatch(
  db: Database,
  santaId: number,
  gifteeId: number,
  overrides: Partial<{ match_status: 'draft' | 'shared' | 'locked' }> = {}
) {
  return await db
    .insertInto('match')
    .values({
      santa: santaId,
      giftee: gifteeId,
      has_present: 0,
      invalid_player: 0,
      match_status: 'shared',
      nudge_count: 0,
      nudge_present_update_count: 0,
      tracking_count: 0,
      tracking_missing_count: 0,
      super_santa_match: 0,
      posted_opening: 0,
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function insertMastodonToken(db: Database) {
  await db
    .insertInto('mastodon_token')
    .values({
      account: SANTA_MASTODON_HANDLE,
      mastodon_id: '9876',
      token: 'mastodon-token',
      client_id: 'client-id',
      issued_at: '2025-12-01T00:00:00Z',
    })
    .execute();
}

async function getService(db: Database) {
  const follow = vi.fn().mockResolvedValue({
    uri: 'at://did:plc:santa/app.bsky.graph.follow/123',
  }) as unknown as Mock;
  const santaAgent = vi.fn().mockResolvedValue({ follow } as unknown as Agent);
  const sendDm = vi.fn().mockResolvedValue(undefined) as unknown as Mock;
  const dmSender = { sendDm } as unknown as DmSender;
  const service = new PlayerService(
    db,
    santaAgent,
    SANTA_DID,
    dmSender,
    new Set(),
    SANTA_MASTODON_HANDLE,
    SANTA_MASTODON_HOST
  );
  await service.init();
  return { service, follow, sendDm };
}

describe('PlayerService', () => {
  let db: Database;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    process.env.FOLLOWING_CHANGED_WEBHOOK =
      'https://example.com/following-changed';
    process.env.HANDLE_CHANGED_WEBHOOK = 'https://example.com/handle-changed';
    process.env.OPTED_OUT_WEBHOOK = 'https://example.com/opted-out';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.FOLLOWING_CHANGED_WEBHOOK;
    delete process.env.HANDLE_CHANGED_WEBHOOK;
    delete process.env.OPTED_OUT_WEBHOOK;
  });

  describe('init and settingsChanged', () => {
    it('init() starts no timers; startBackground() starts the refresh intervals', async () => {
      db = await setupDb();
      const { service } = await getService(db);
      expect(vi.getTimerCount()).toBe(0);

      service.startBackground();
      expect(vi.getTimerCount()).toBe(3);

      service.stopBackground();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('also starts the auto follow interval when enabled in settings', async () => {
      db = await setupDb();
      await db
        .updateTable('settings')
        .set({ auto_follow: 1 })
        .where('id', '=', 0)
        .execute();
      const { service } = await getService(db);
      expect(vi.getTimerCount()).toBe(1);

      service.startBackground();
      expect(vi.getTimerCount()).toBe(4);
    });

    it('starts and stops the auto follow interval from settingsChanged', async () => {
      db = await setupDb();
      const { service } = await getService(db);
      expect(vi.getTimerCount()).toBe(0);

      await service.settingsChanged({ auto_follow: 1 });
      expect(vi.getTimerCount()).toBe(1);

      await service.settingsChanged({ auto_follow: 0 });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('getPlayer', () => {
    it('returns undefined for missing players', async () => {
      db = await setupDb();
      const { service } = await getService(db);
      expect(await service.getPlayer('did:plc:missing')).toBeUndefined();
    });

    it('exposes follow status and completion flags instead of raw columns', async () => {
      db = await setupDb();
      await insertPlayer(db, {
        did: 'did:plc:1',
        handle: 'one.bsky.social',
        following_santa_uri: 'at://did:plc:santa/app.bsky.graph.follow/11',
      });
      const { service } = await getService(db);

      const player = await service.getPlayer('did:plc:1');
      expect(player).toMatchObject({
        did: 'did:plc:1',
        handle: 'one.bsky.social',
        following_santa: true,
        profile_complete: true,
        signup_complete: true,
        address_review_required: false,
        opted_out: false,
      });
      expect(player).not.toHaveProperty('following_santa_uri');
      expect(player).not.toHaveProperty('santa_following_uri');
    });
  });

  describe('getPlayerById', () => {
    it('returns undefined for missing players', async () => {
      db = await setupDb();
      const { service } = await getService(db);
      expect(await service.getPlayerById(999)).toBeUndefined();
    });

    it('returns the player for a known id', async () => {
      db = await setupDb();
      const inserted = await insertPlayer(db, { did: 'did:plc:5' });
      const { service } = await getService(db);

      const player = await service.getPlayerById(inserted.id);
      expect(player?.did).toBe('did:plc:5');
    });
  });

  describe('recordFollow', () => {
    it('records a player following santa', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1' });
      const { service } = await getService(db);

      await service.recordFollow('did:plc:1', SANTA_DID, 'at://follow/456');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.following_santa_uri).toBe('at://follow/456');
    });

    it('records santa following a player', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1' });
      const { service } = await getService(db);

      await service.recordFollow(SANTA_DID, 'did:plc:1', 'at://follow/123');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.santa_following_uri).toBe('at://follow/123');
    });

    it('ignores follows between other players', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1' });
      const { service } = await getService(db);

      await service.recordFollow('did:plc:2', 'did:plc:3', 'at://follow/789');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.following_santa_uri).not.toBe('at://follow/789');
      expect(player.santa_following_uri).toBeNull();
    });
  });

  describe('removeFollow', () => {
    it('clears the santa follow for players who unfollow santa', async () => {
      db = await setupDb();
      await insertPlayer(db, {
        did: 'did:plc:1',
        giftee_count: 0,
        following_santa_uri: 'at://did:plc:1/app.bsky.graph.follow/9',
      });
      const { service } = await getService(db);

      await service.removeFollow('at://did:plc:1/app.bsky.graph.follow/9');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.following_santa_uri).toBeNull();
      expect(postWebhook).not.toHaveBeenCalled();
    });

    it('notifies the webhook when a giftee unfollows santa', async () => {
      db = await setupDb();
      await insertPlayer(db, {
        did: 'did:plc:1',
        handle: 'one.bsky.social',
        giftee_count: 2,
        following_santa_uri: 'at://did:plc:1/app.bsky.graph.follow/9',
      });
      const { service } = await getService(db);

      await service.removeFollow('at://did:plc:1/app.bsky.graph.follow/9');
      expect(postWebhook).toHaveBeenCalledWith(
        'https://example.com/following-changed',
        {
          player_did: 'did:plc:1',
          player_handle: 'one.bsky.social',
          following_santa: false,
        }
      );
    });

    it('clears santa_following_uri when santa unfollows a player', async () => {
      db = await setupDb();
      const player = await insertPlayer(db, {
        did: 'did:plc:1',
        santa_following_uri: 'at://did:plc:santa/app.bsky.graph.follow/7',
      });
      const { service } = await getService(db);

      await service.removeFollow('at://did:plc:santa/app.bsky.graph.follow/7');
      const updated = await db
        .selectFrom('player')
        .selectAll()
        .where('id', '=', player.id)
        .executeTakeFirstOrThrow();
      expect(updated.santa_following_uri).toBeNull();
    });
  });

  describe('optOut', () => {
    it('opts a player out', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1' });
      const { service } = await getService(db);

      const optedOut = await service.optOut('did:plc:1');
      expect(optedOut?.opted_out).toBe(true);
      expect(postWebhook).not.toHaveBeenCalled();
    });

    it('notifies the webhook for opted out players with giftees', async () => {
      db = await setupDb();
      await insertPlayer(db, {
        did: 'did:plc:1',
        handle: 'opting.out.bsky.social',
        giftee_count: 1,
        giftee_for_count: 1,
      });
      const { service } = await getService(db);

      await service.optOut('did:plc:1');
      expect(postWebhook).toHaveBeenCalledWith(
        'https://example.com/opted-out',
        {
          player_did: 'did:plc:1',
          player_handle: 'opting.out.bsky.social',
          giftee_count: 1,
          giftee_for_count: 1,
        }
      );
      expect(newrelicMock.recordCustomEvent).toHaveBeenCalledWith(
        'SecretSantaOptedOut',
        expect.objectContaining({ playerDid: 'did:plc:1' })
      );
    });

    it('returns undefined for missing players', async () => {
      db = await setupDb();
      const { service } = await getService(db);
      expect(await service.optOut('did:plc:missing')).toBeUndefined();
    });
  });

  describe('patchPlayer', () => {
    it('updates player fields', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1', game_mode: 'Regular' });
      const { service } = await getService(db);

      const patched = await service.patchPlayer('did:plc:1', {
        game_mode: 'Santa Only',
        address: '2 New St',
      } as PatchUpdates);
      expect(patched?.game_mode).toBe('Santa Only');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.address).toBe('2 New St');
    });

    it('records a timestamp when address review is required', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1' });
      const { service } = await getService(db);

      await service.patchPlayer('did:plc:1', {
        address_review_required: true,
      } as PatchUpdates);
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.address_review_required).not.toBeNull();
    });

    it('clears the opt out timestamps', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1' });
      const { service } = await getService(db);

      const patched = await service.patchPlayer('did:plc:1', {
        opted_out: true,
      } as PatchUpdates);
      expect(patched?.opted_out).not.toBeNull();

      await service.patchPlayer('did:plc:1', {
        opted_out: false,
      } as PatchUpdates);
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.opted_out).toBeNull();
    });
  });

  describe('deletePlayer', () => {
    it('removes the player and notifies listeners', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1' });
      const { service } = await getService(db);
      const listener = vi.fn();
      service.addListener(listener);

      await service.deletePlayer('did:plc:1');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirst();
      expect(player).toBeUndefined();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetEverything', () => {
    it('clears game state', async () => {
      db = await setupDb();
      await insertPlayer(db, {
        did: 'did:plc:1',
        address: '1 St',
        game_mode: 'Regular',
        giftee_count: 2,
        player_dm_status: 'queued',
      });
      const booted = await insertPlayer(db, {
        did: 'did:plc:booted',
        address: '2 St',
        game_mode: 'Regular',
        booted: '2025-01-01T00:00:00.000Z',
        next_player_dm: 'signup-complete-2',
      });
      await insertMatch(db, booted.id, 1);
      const { service } = await getService(db);

      await service.resetEverything();
      // Unbooted players are removed entirely.
      const removed = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirst();
      expect(removed).toBeUndefined();

      // Remaining players have their game data cleared.
      const reset = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:booted')
        .executeTakeFirstOrThrow();
      expect(reset.address).toBeNull();
      expect(reset.game_mode).toBeNull();
      expect(reset.giftee_count).toBe(0);
      expect(reset.giftee_count_status).toBe('full');
      expect(reset.next_player_dm).toBe('signup-complete-1');
      expect(reset.player_dm_status).toBe('queued');

      const matchCount = await db
        .selectFrom('match')
        .select(({ fn }) => fn.countAll<number>().as('cnt'))
        .executeTakeFirstOrThrow();
      expect(Number(matchCount.cnt)).toBe(0);
    });
  });

  describe('getSantaMastodonToken', () => {
    it('returns the santa token from the database', async () => {
      db = await setupDb();
      await insertMastodonToken(db);
      const { service } = await getService(db);

      const token = await service.getSantaMastodonToken();
      expect(token?.token).toBe('mastodon-token');
      expect(token?.mastodon_id).toBe('9876');
    });

    it('returns undefined when there is no token', async () => {
      db = await setupDb();
      const { service } = await getService(db);
      expect(await service.getSantaMastodonToken()).toBeUndefined();
    });
  });

  describe('queryMastodonRelationships', () => {
    it('returns an empty map when santa has no mastodon token', async () => {
      db = await setupDb();
      const { service } = await getService(db);
      expect(await service.queryMastodonRelationships('111')).toEqual({});
    });

    it('maps relationships by mastodon id', async () => {
      db = await setupDb();
      await insertMastodonToken(db);
      vi.mocked(fetchMastodonRelationships).mockResolvedValue([
        { id: '111', following: false, followed_by: true, requested: false },
      ]);
      const { service } = await getService(db);

      const relationships = await service.queryMastodonRelationships('111');
      expect(relationships['111']).toStrictEqual({
        mastodon_id: '111',
        mastodon_following_santa: 1,
        mastodon_followed_by_santa: 0,
        mastodon_follow_last_checked: expect.any(String),
      });
    });
  });

  describe('lookupMastodonFollowing', () => {
    it('returns santa relationships for the santa account', async () => {
      db = await setupDb();
      await insertMastodonToken(db);
      const { service } = await getService(db);

      const result = await service.lookupMastodonFollowing(
        SANTA_MASTODON_HANDLE
      );
      expect(result).toStrictEqual({
        mastodon_id: '9876',
        mastodon_following_santa: 1,
        mastodon_followed_by_santa: 1,
        mastodon_follow_last_checked: '9999-12-30T23:59:59.999Z',
      });
    });

    it('looks up other accounts relationships', async () => {
      db = await setupDb();
      await insertMastodonToken(db);
      vi.mocked(lookupMastodonAccount).mockResolvedValue({
        id: '5555',
      });
      vi.mocked(fetchMastodonRelationships).mockResolvedValue([
        { id: '5555', following: false, followed_by: true, requested: false },
      ]);
      const { service } = await getService(db);

      const result = await service.lookupMastodonFollowing(
        'user@example.social'
      );
      expect(result?.mastodon_id).toBe('5555');
      expect(result?.mastodon_following_santa).toBe(1);
      expect(result?.mastodon_followed_by_santa).toBe(0);
    });
  });

  describe('lookupBridgedMastodonHandle', () => {
    it('resolves a bridged mastodon handle', async () => {
      db = await setupDb();
      vi.mocked(fetchBridgedMastodonPage).mockResolvedValue('<html/>');
      vi.mocked(parseBridgedMastodonHandle).mockReturnValue(
        'user@example.social'
      );
      const { service } = await getService(db);

      expect(
        await service.lookupBridgedMastodonHandle('user.bsky.social')
      ).toBe('user@example.social');
    });

    it('returns null when the lookup fails', async () => {
      db = await setupDb();
      vi.mocked(fetchBridgedMastodonPage).mockResolvedValue(null);
      const { service } = await getService(db);

      expect(
        await service.lookupBridgedMastodonHandle('user.bsky.social')
      ).toBeNull();
    });
  });

  describe('lookupBridgedBlueskyHandle', () => {
    it('resolves a bridged bluesky handle', async () => {
      db = await setupDb();
      vi.mocked(fetchBridgedBlueskyPage).mockResolvedValue('<html/>');
      vi.mocked(parseBridgedBlueskyHandle).mockReturnValue('user.bsky.social');
      const { service } = await getService(db);

      expect(
        await service.lookupBridgedBlueskyHandle('user@example.social')
      ).toBe('user.bsky.social');
    });

    it('returns null when the lookup fails', async () => {
      db = await setupDb();
      vi.mocked(fetchBridgedBlueskyPage).mockResolvedValue(null);
      const { service } = await getService(db);

      expect(
        await service.lookupBridgedBlueskyHandle('user@example.social')
      ).toBeNull();
    });
  });

  describe('retryPlayerDms', () => {
    it('queues dms for bluesky players with chat enabled', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1' });
      vi.mocked(unauthenticatedAgent.getProfile).mockResolvedValue({
        data: { associated: { chat: { allowIncoming: 'all' } } },
      } as never);
      const { service } = await getService(db);

      await service.retryPlayerDms('did:plc:1');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.player_dm_status).toBe('queued');
    });

    it('marks dms as failed for bluesky players with chat disabled', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1' });
      vi.mocked(unauthenticatedAgent.getProfile).mockResolvedValue({
        data: { associated: { chat: { allowIncoming: 'none' } } },
      } as never);
      const { service } = await getService(db);

      await service.retryPlayerDms('did:plc:1');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.player_dm_status).toBe('error: DMs Disabled');
    });

    it('always queues mastodon players', async () => {
      db = await setupDb();
      await insertPlayer(db, {
        did: 'did:plc:m1',
        player_type: 'mastodon',
      });
      vi.mocked(unauthenticatedAgent.getProfile).mockResolvedValue({
        data: { associated: { chat: { allowIncoming: 'none' } } },
      } as never);
      const { service } = await getService(db);

      await service.retryPlayerDms('did:plc:m1');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:m1')
        .executeTakeFirstOrThrow();
      expect(player.player_dm_status).toBe('queued');
    });
  });

  describe('followPlayers', () => {
    it('follows bluesky players without a santa follow', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1', santa_following_uri: null });
      // Not following santa means the player never completed signup.
      await insertPlayer(db, {
        did: 'did:plc:unsignuped',
        following_santa_uri: null,
      });
      const { follow, service } = await getService(db);

      await service['followPlayers']();
      expect(follow).toHaveBeenCalledTimes(1);
      expect(follow).toHaveBeenCalledWith('did:plc:1');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.santa_following_uri).toBe(
        'at://did:plc:santa/app.bsky.graph.follow/123'
      );
      const unsignuped = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:unsignuped')
        .executeTakeFirstOrThrow();
      expect(unsignuped.santa_following_uri).toBeNull();
    });

    it('records follow errors on the player', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1', santa_following_uri: null });
      const { follow, service } = await getService(db);
      follow.mockRejectedValueOnce(new Error('boom'));

      await service['followPlayers']();
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.santa_following_uri).toBe('Error: boom');
    });

    it('follows mastodon players using the santa token', async () => {
      db = await setupDb();
      await insertMastodonToken(db);
      await insertPlayer(db, {
        did: 'did:plc:m1',
        player_type: 'mastodon',
        mastodon_account: 'm1@example.social',
        mastodon_id: '111',
        mastodon_followed_by_santa: 0,
        santa_following_uri: 'at://did:plc:santa/app.bsky.graph.follow/2',
      });
      vi.mocked(followMastodonAccount).mockResolvedValue(undefined);
      const { service } = await getService(db);

      await service['followPlayers']();
      expect(followMastodonAccount).toHaveBeenCalledWith(
        SANTA_MASTODON_HOST,
        'mastodon-token',
        '111'
      );
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:m1')
        .executeTakeFirstOrThrow();
      expect(player.mastodon_followed_by_santa).toBe(1);
    });
  });

  describe('refreshBlueskyBridging', () => {
    it('updates the mastodon account for bridged players', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1' });
      vi.mocked(fetchBridgedMastodonPage).mockResolvedValue('<html/>');
      vi.mocked(parseBridgedMastodonHandle).mockReturnValue(
        'one@example.social'
      );
      const { service } = await getService(db);

      await service['refreshBlueskyBridging']();
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.mastodon_account).toBe('one@example.social');
      expect(player.mastodon_follow_last_checked).not.toBeNull();
    });

    it('marks the check timestamp for unbridged players', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1' });
      vi.mocked(fetchBridgedMastodonPage).mockResolvedValue(null);
      const { service } = await getService(db);

      await service['refreshBlueskyBridging']();
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.mastodon_account).toBeNull();
      expect(player.mastodon_follow_last_checked).not.toBeNull();
    });

    it('returns early when there is nobody to check', async () => {
      db = await setupDb();
      const { service } = await getService(db);

      await service['refreshBlueskyBridging']();
      expect(fetchBridgedMastodonPage).not.toHaveBeenCalled();
      const counts = await db
        .selectFrom('player')
        .select(({ fn }) => fn.countAll<number>().as('cnt'))
        .executeTakeFirstOrThrow();
      expect(Number(counts.cnt)).toBe(0);
    });
  });

  describe('refreshMastodonFollowing', () => {
    it('refreshes the following status of mastodon players', async () => {
      db = await setupDb();
      await insertMastodonToken(db);
      await insertPlayer(db, {
        did: 'did:plc:m1',
        player_type: 'mastodon',
        mastodon_id: '111',
        mastodon_following_santa: 0,
      });
      await insertPlayer(db, {
        did: 'did:plc:m2',
        player_type: 'mastodon',
        mastodon_id: '112',
        mastodon_following_santa: 0,
      });
      // Only m1 appears in the relationships response; m2 falls back to defaults.
      vi.mocked(fetchMastodonRelationships).mockResolvedValue([
        { id: '111', following: true, followed_by: true, requested: false },
      ]);
      const { service } = await getService(db);

      await service['refreshMastodonFollowing']();
      const m1 = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:m1')
        .executeTakeFirstOrThrow();
      expect(m1.mastodon_following_santa).toBe(1);
      expect(m1.mastodon_followed_by_santa).toBe(1);
      const m2 = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:m2')
        .executeTakeFirstOrThrow();
      expect(m2.mastodon_following_santa).toBe(0);
      expect(m2.mastodon_follow_last_checked).not.toBeNull();
    });
  });

  describe('refreshPostCounts', () => {
    it('refreshes post counts for checked out players', async () => {
      db = await setupDb();
      await insertPlayer(db, {
        did: 'did:plc:111111111',
        last_checked_post_count: '2020-01-01T00:00:00.000Z',
      });
      await insertPlayer(db, {
        did: 'did:plc:222222222',
        post_count: 3,
        last_checked_post_count: '2020-01-01T00:00:00.000Z',
      });
      vi.mocked(unauthenticatedAgent.getProfiles).mockResolvedValue({
        data: {
          profiles: [{ did: 'did:plc:111111111', postsCount: 42 }],
        },
      } as never);
      const { service } = await getService(db);

      await service['refreshPostCounts']();
      const one = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:111111111')
        .executeTakeFirstOrThrow();
      expect(one.post_count).toBe(42);
      expect(one.post_count_since_signup).toBe(0);
      const two = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:222222222')
        .executeTakeFirstOrThrow();
      expect(two.post_count).toBe(0);
    });

    it('skips the lookup when no players need refreshing', async () => {
      db = await setupDb();
      await insertPlayer(db, {
        did: 'did:plc:1',
        last_checked_post_count: new Date().toISOString(),
      });
      const { service } = await getService(db);

      await service['refreshPostCounts']();
      expect(unauthenticatedAgent.getProfiles).not.toHaveBeenCalled();
    });
  });

  describe('updateHandle', () => {
    it('updates the handle for players without any matches', async () => {
      db = await setupDb();
      await insertPlayer(db, { did: 'did:plc:1', handle: 'old.bsky.social' });
      const { sendDm, service } = await getService(db);

      await service.updateHandle('did:plc:1', 'new.bsky.social');
      expect(sendDm).not.toHaveBeenCalled();
      expect(postWebhook).not.toHaveBeenCalled();
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.handle).toBe('new.bsky.social');
    });

    it('notifies santas with a match about the handle change', async () => {
      db = await setupDb();
      const santa = await insertPlayer(db, {
        did: 'did:plc:santa-different',
        handle: 'santa2.bsky.social',
      });
      const giftee = await insertPlayer(db, {
        did: 'did:plc:giftee',
        handle: 'old.bsky.social',
        giftee_count: 2,
        giftee_for_count: 1,
      });
      await insertMatch(db, santa.id, giftee.id);
      const { sendDm, service } = await getService(db);

      await service.updateHandle('did:plc:giftee', 'new.bsky.social');
      expect(sendDm).toHaveBeenCalledWith(
        expect.objectContaining({
          dmType: 'change-handle',
          recipientDid: 'did:plc:santa-different',
        })
      );
      const dm = (sendDm as unknown as Mock).mock.calls.at(-1)?.[0] as {
        rawMessage: string;
      };
      expect(dm.rawMessage).toContain('@old.bsky.social');
      expect(dm.rawMessage).toContain('@new.bsky.social');
      expect(postWebhook).toHaveBeenCalledWith(
        'https://example.com/handle-changed',
        {
          player_did: 'did:plc:giftee',
          old_handle: 'old.bsky.social',
          new_handle: 'new.bsky.social',
        }
      );
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:giftee')
        .executeTakeFirstOrThrow();
      expect(player.handle).toBe('new.bsky.social');
    });

    it('skips the dm when the santa is the santa account itself', async () => {
      db = await setupDb();
      const santa = await insertPlayer(db, { did: SANTA_DID });
      const giftee = await insertPlayer(db, {
        did: 'did:plc:giftee',
        handle: 'old.bsky.social',
        giftee_count: 2,
        giftee_for_count: 1,
      });
      await insertMatch(db, santa.id, giftee.id);
      const { sendDm, service } = await getService(db);

      await service.updateHandle('did:plc:giftee', 'new.bsky.social');
      expect(sendDm).not.toHaveBeenCalled();
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:giftee')
        .executeTakeFirstOrThrow();
      expect(player.handle).toBe('new.bsky.social');
    });

    it('bridges mastodon accounts when the player is bridged', async () => {
      db = await setupDb();
      await insertPlayer(db, {
        did: 'did:plc:1',
        handle: 'old.bsky.social',
        mastodon_account: 'old.bsky.social@bsky.brid.gy',
      });
      const { service } = await getService(db);

      await service.updateHandle('did:plc:1', 'new.bsky.social');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:1')
        .executeTakeFirstOrThrow();
      expect(player.mastodon_account).toBe('new.bsky.social@bsky.brid.gy');
    });

    it('still records the change when sending the dm fails', async () => {
      db = await setupDb();
      const santa = await insertPlayer(db, {
        did: 'did:plc:santa-different',
        handle: 'santa2.bsky.social',
      });
      const giftee = await insertPlayer(db, {
        did: 'did:plc:giftee',
        handle: 'old.bsky.social',
        giftee_count: 2,
        giftee_for_count: 1,
      });
      await insertMatch(db, santa.id, giftee.id);
      const santaAgent = vi.fn().mockResolvedValue({} as unknown as Agent);
      const sendDm = vi.fn().mockRejectedValue(new Error('dm fail'));
      const dmSender = { sendDm } as unknown as DmSender;
      const service = new PlayerService(
        db,
        santaAgent,
        SANTA_DID,
        dmSender,
        new Set(),
        SANTA_MASTODON_HANDLE,
        SANTA_MASTODON_HOST
      );
      await service.init();

      await service.updateHandle('did:plc:giftee', 'new.bsky.social');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:giftee')
        .executeTakeFirstOrThrow();
      expect(player.handle).toBe('new.bsky.social');
      expect(newrelicMock.noticeError).toHaveBeenCalled();
    });
  });

  describe('createPlayer', () => {
    it('creates a bluesky player with the relationship info from the public api', async () => {
      db = await setupDb();
      vi.mocked(unauthenticatedAgent.getProfile).mockResolvedValue({
        data: {
          did: 'did:plc:new',
          handle: 'new.bsky.social',
          avatar: null,
          postsCount: 5,
          labels: [],
          associated: { chat: { allowIncoming: 'all' } },
        },
      } as never);
      vi.mocked(fetchRelationships).mockResolvedValue({
        relationships: [
          relationship('did:plc:new', {
            followedBy: 'at://did:plc:santa/app.bsky.graph.follow/31',
          }),
        ],
      } as never);
      vi.mocked(fetchBridgedMastodonPage).mockResolvedValue(null);
      const { service } = await getService(db);

      await service.createPlayer('did:plc:new', 'bluesky');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:new')
        .executeTakeFirstOrThrow();
      expect(player.handle).toBe('new.bsky.social');
      expect(player.following_santa_uri).toBe(
        'at://did:plc:santa/app.bsky.graph.follow/31'
      );
      expect(player.player_dm_status).toBe('queued');
      expect(player.admin).toBe(0);
      expect(player.post_count).toBe(5);
      expect(player.profile_public).toBe(1);
    });

    it('marks elf dids as admins', async () => {
      db = await setupDb();
      vi.mocked(unauthenticatedAgent.getProfile).mockResolvedValue({
        data: {
          did: 'did:plc:elf',
          handle: 'elf.bsky.social',
          avatar: null,
          postsCount: 1,
          labels: [],
          associated: {},
        },
      } as never);
      vi.mocked(fetchRelationships).mockResolvedValue({
        relationships: [relationship('did:plc:elf')],
      } as never);
      vi.mocked(fetchBridgedMastodonPage).mockResolvedValue(null);
      const santaAgent = vi.fn().mockResolvedValue({} as unknown as Agent);
      const dmSender = { sendDm: vi.fn() } as unknown as DmSender;
      const service = new PlayerService(
        db,
        santaAgent,
        SANTA_DID,
        dmSender,
        new Set(['did:plc:elf']),
        SANTA_MASTODON_HANDLE,
        SANTA_MASTODON_HOST
      );
      await service.init();

      await service.createPlayer('did:plc:elf', 'bluesky');
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:elf')
        .executeTakeFirstOrThrow();
      expect(player.admin).toBe(1);
    });

    it('creates a mastodon player with the relationship info from the mastodon api', async () => {
      db = await setupDb();
      await insertMastodonToken(db);
      vi.mocked(unauthenticatedAgent.getProfile).mockResolvedValue({
        data: {
          did: 'did:plc:m1',
          handle: 'm1.example.social',
          avatar: null,
          postsCount: 2,
          labels: [],
          associated: {},
        },
      } as never);
      vi.mocked(fetchRelationships).mockResolvedValue({
        relationships: [relationship('did:plc:m1')],
      } as never);
      vi.mocked(lookupMastodonAccount).mockResolvedValue({ id: '111' });
      vi.mocked(fetchMastodonRelationships).mockResolvedValue([
        { id: '111', following: true, followed_by: false, requested: false },
      ]);
      const { service } = await getService(db);

      await service.createPlayer('did:plc:m1', 'mastodon', {
        mastodon_account: 'm1@example.social',
      });
      const player = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', 'did:plc:m1')
        .executeTakeFirstOrThrow();
      expect(player.mastodon_account).toBe('m1@example.social');
      expect(player.mastodon_id).toBe('111');
      expect(player.mastodon_followed_by_santa).toBe(1);
      expect(player.player_dm_status).toBe('queued');
    });
  });
});
