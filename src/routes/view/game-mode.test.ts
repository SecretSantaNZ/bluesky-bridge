import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createDb,
  migrateToLatest,
  type Database,
} from '../../lib/database/index.js';
import type { DatabaseSchema } from '../../lib/database/schema.js';
import type { InsertObject } from 'kysely';
import { updateGifteePreferences } from './game-mode.js';
import { PlayerService } from '../../lib/PlayerService.js';
import type { Agent } from '@atproto/api';
import type { DmSender } from '../../lib/DmSender.js';
import { BadRequestError } from 'http-errors-enhanced';

vi.mock('../../bluesky.js', () => ({
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

vi.mock('../../lib/bluesky.js', () => ({
  fetchRelationships: vi.fn().mockResolvedValue({ relationships: [] }),
}));

vi.mock('../../lib/webhooks.js', () => ({
  postWebhook: vi.fn(),
}));

vi.mock('../../lib/mastodon.js', () => ({
  fetchMastodonRelationships: vi.fn().mockResolvedValue([]),
  lookupMastodonAccount: vi.fn().mockResolvedValue({ id: '1' }),
  followMastodonAccount: vi.fn(),
}));

vi.mock('../../lib/bridgyfed.js', () => ({
  fetchBridgedMastodonPage: vi.fn().mockResolvedValue(null),
  fetchBridgedBlueskyPage: vi.fn().mockResolvedValue(null),
  parseBridgedMastodonHandle: vi.fn(),
  parseBridgedBlueskyHandle: vi.fn(),
}));

async function getPlayerService(db: Database) {
  const santaAgent = vi.fn().mockResolvedValue({} as unknown as Agent);
  const dmSender = { sendDm: vi.fn() } as unknown as DmSender;
  return new PlayerService(
    db,
    santaAgent,
    'did:plc:santa',
    dmSender,
    new Set(),
    'santa@mastodon.social',
    'mastodon.social'
  );
}

async function insertPlayer(
  db: Database,
  overrides: Partial<InsertObject<DatabaseSchema, 'player'>> = {}
) {
  return await db
    .insertInto('player')
    .values({
      did: 'did:plc:player',
      handle: 'player.bsky.social',
      player_type: 'bluesky',
      profile_complete: 1,
      signup_complete: 1,
      max_giftees: 1,
      giftee_count: 0,
      game_mode: 'Regular',
      address: '1 St',
      following_santa_uri: 'at://did:plc:santa/app.bsky.graph.follow/1',
      ...overrides,
    } as InsertObject<DatabaseSchema, 'player'>)
    .returningAll()
    .executeTakeFirstOrThrow();
}

describe('updateGifteePreferences', () => {
  let db: Database;

  beforeEach(async () => {
    db = createDb();
    await migrateToLatest(db);
    process.env.FOLLOWING_CHANGED_WEBHOOK =
      'https://example.com/following-changed';
    process.env.HANDLE_CHANGED_WEBHOOK = 'https://example.com/handle-changed';
    process.env.OPTED_OUT_WEBHOOK = 'https://example.com/opted-out';
  });

  afterEach(() => {
    delete process.env.FOLLOWING_CHANGED_WEBHOOK;
    delete process.env.HANDLE_CHANGED_WEBHOOK;
    delete process.env.OPTED_OUT_WEBHOOK;
  });

  it('refuses to change game mode once signups have closed', async () => {
    const player = await insertPlayer(db);
    await db
      .updateTable('settings')
      .set({ signups_open: 0 })
      .where('id', '=', 0)
      .execute();
    await expect(
      updateGifteePreferences(db, await getPlayerService(db), player.did, {
        game_mode: 'Regular',
        max_giftees: 1,
      })
    ).rejects.toThrow(BadRequestError);
  });

  it('persists a regular game mode with a single giftee', async () => {
    const player = await insertPlayer(db, { max_giftees: 3 });
    const service = await getPlayerService(db);
    const updated = await updateGifteePreferences(db, service, player.did, {
      game_mode: 'Regular',
      max_giftees: 3,
    });
    expect(updated?.max_giftees).toBe(1);
    const row = await db
      .selectFrom('player')
      .selectAll()
      .where('id', '=', player.id)
      .executeTakeFirstOrThrow();
    expect(row.max_giftees).toBe(1);
    expect(row.game_mode).toBe('Regular');
  });

  it('returns undefined for unknown players', async () => {
    await expect(
      updateGifteePreferences(
        db,
        await getPlayerService(db),
        'did:plc:missing',
        { game_mode: 'Regular', max_giftees: 1 }
      )
    ).resolves.toBeUndefined();
  });
});
