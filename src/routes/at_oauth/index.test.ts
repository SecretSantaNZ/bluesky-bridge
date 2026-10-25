import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createDb,
  migrateToLatest,
  type Database,
} from '../../lib/database/index.js';
import type { DatabaseSchema } from '../../lib/database/schema.js';
import type { InsertObject, UpdateObject } from 'kysely';
import {
  consumeOtpLogin,
  getOrCreatePlayer,
  isSessionExpired,
  normalizeBlueskyHandle,
  signupsNotYetOpen,
  verifyLoginCode,
} from './index.js';
import { PlayerService } from '../../lib/PlayerService.js';
import type { Agent } from '@atproto/api';
import type { DmSender } from '../../lib/DmSender.js';

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
vi.mock('../../bluesky.js', () => ({
  unauthenticatedAgent: {
    resolveHandle: vi.fn().mockResolvedValue({ data: { did: 'did:plc:x' } }),
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

// These modules perform their work over HTTP against external services
// (public Bluesky api, Mastodon hosts, the Bluesky/Mastodon bridge).
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

async function buildService(
  db: Database,
  elfDids: ReadonlySet<string> = new Set()
) {
  const santaAgent = vi.fn().mockResolvedValue({} as unknown as Agent);
  const sendDm = vi.fn().mockResolvedValue(undefined);
  const dmSender = { sendDm } as unknown as DmSender;
  return new PlayerService(
    db,
    santaAgent,
    'did:plc:santa',
    dmSender,
    elfDids,
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

describe('normalizeBlueskyHandle', () => {
  it('lower-cases and strips the leading @', () => {
    expect(normalizeBlueskyHandle('@Player.Bsky.Social')).toBe(
      'player.bsky.social'
    );
  });

  it('converts @ separators to dots', () => {
    expect(normalizeBlueskyHandle('username@host.social')).toBe(
      'username.host.social'
    );
  });

  it('appends .bsky.social to single-label handles', () => {
    expect(normalizeBlueskyHandle('username')).toBe('username.bsky.social');
  });
});

describe('consumeOtpLogin', () => {
  let db: Database;

  beforeEach(async () => {
    db = createDb();
    await migrateToLatest(db);
  });

  const insertOtp = (
    overrides: Partial<InsertObject<DatabaseSchema, 'otp_login'>> = {}
  ) =>
    db
      .insertInto('otp_login')
      .values({
        key: 'some-key',
        code: '123456',
        did: 'did:plc:player',
        expires: '2100-01-01T00:00:00.000Z',
        attempts: 0,
        ...overrides,
      })
      .execute();

  it('returns the row and increments attempts inside the expiry window', async () => {
    await insertOtp();
    const result = await consumeOtpLogin(db, 'some-key');
    expect(result?.code).toBe('123456');
    expect(Number(result?.attempts)).toBe(1);
  });

  it('returns nothing once the attempt limit is reached', async () => {
    await insertOtp({ attempts: 3 });
    expect(await consumeOtpLogin(db, 'some-key')).toBeUndefined();
  });

  it('returns nothing for expired keys', async () => {
    await insertOtp({ expires: '2000-01-01T00:00:00.000Z' });
    expect(await consumeOtpLogin(db, 'some-key')).toBeUndefined();
  });
});

describe('verifyLoginCode', () => {
  it('accepts the exact code', () => {
    expect(verifyLoginCode('123456', '123456')).toBe(true);
  });

  it('zero-pads codes shorter than six digits', () => {
    expect(verifyLoginCode('1234', '123400')).toBe(true);
  });

  it('rejects a wrong code', () => {
    expect(verifyLoginCode('654321', '123456')).toBe(false);
  });
});

describe('signups open window', () => {
  it('is still closed for the first 24 hours after the open date', () => {
    const settings = { signups_open_date: '2025-12-02' };
    // 2025-12-02 18:00 in Pacific/Auckland (UTC+13 in summer)
    expect(
      signupsNotYetOpen(settings, new Date('2025-12-02T05:00:00.000Z'))
    ).toBe(true);
  });

  it('opens 24 hours after the configured date', () => {
    const settings = { signups_open_date: '2025-12-02' };
    // 2025-12-03 00:00 in Pacific/Auckland (UTC+13 in summer)
    expect(
      signupsNotYetOpen(settings, new Date('2025-12-02T11:00:00.000Z'))
    ).toBe(false);
  });
});

describe('isSessionExpired', () => {
  it('expires sessions older than 12 hours', () => {
    const startedAt = '2025-12-01T00:00:00.000Z';
    expect(isSessionExpired(startedAt, new Date('2025-12-01T11:00:00Z'))).toBe(
      false
    );
    expect(isSessionExpired(startedAt, new Date('2025-12-01T13:00:00Z'))).toBe(
      true
    );
  });
});

describe('getOrCreatePlayer', () => {
  let db: Database;

  beforeEach(async () => {
    db = createDb();
    await migrateToLatest(db);
    process.env.FOLLOWING_CHANGED_WEBHOOK =
      'https://example.com/following-changed';
    process.env.HANDLE_CHANGED_WEBHOOK = 'https://example.com/handle-changed';
    process.env.OPTED_OUT_WEBHOOK = 'https://example.com/opted-out';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.FOLLOWING_CHANGED_WEBHOOK;
    delete process.env.HANDLE_CHANGED_WEBHOOK;
    delete process.env.OPTED_OUT_WEBHOOK;
  });

  const setSettings = (
    updates: UpdateObject<DatabaseSchema, 'settings', 'settings'>
  ) => db.updateTable('settings').set(updates).where('id', '=', 0).execute();

  it('creates the player when signups are open', async () => {
    await setSettings({ signups_open: 1 });
    const result = await getOrCreatePlayer(
      { db, playerService: await buildService(db) },
      'did:plc:new-user',
      'bluesky',
      {}
    );
    const stored = await db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', 'did:plc:new-user')
      .executeTakeFirst();
    expect(stored).toBeDefined();
    expect(result.player?.did).toBe('did:plc:new-user');
  });

  it('denies new mastodon players when mastodon players are disabled', async () => {
    await setSettings({ signups_open: 1, mastodon_players: 0 });
    const result = await getOrCreatePlayer(
      { db, playerService: await buildService(db) },
      'did:plc:new-user',
      'mastodon',
      { mastodon_account: 'user@instance.social' }
    );
    expect(result.denied).toBe('mastodon-disabled');
    const stored = await db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', 'did:plc:new-user')
      .executeTakeFirst();
    expect(stored).toBeUndefined();
  });

  it('returns the existing player when signups are closed', async () => {
    const existing = await insertPlayer(db);
    await setSettings({ signups_open: 0 });
    const result = await getOrCreatePlayer(
      { db, playerService: await buildService(db) },
      existing.did,
      'bluesky',
      {}
    );
    expect(result.player?.id).toBe(existing.id);
    const count = await db
      .selectFrom('player')
      .select(({ fn }) => fn.countAll<number>().as('cnt'))
      .executeTakeFirstOrThrow();
    expect(count.cnt).toBe(1);
  });

  it('does not create unknown non-elf players when signups are closed', async () => {
    await setSettings({ signups_open: 0 });
    const result = await getOrCreatePlayer(
      { db, playerService: await buildService(db) },
      'did:plc:unknown',
      'bluesky',
      {}
    );
    expect(result.player).toBeUndefined();
    expect(result.denied).toBeUndefined();
    const count = await db
      .selectFrom('player')
      .select(({ fn }) => fn.countAll<number>().as('cnt'))
      .executeTakeFirstOrThrow();
    expect(count.cnt).toBe(0);
  });

  it('still creates players for elf DIDs when signups are closed', async () => {
    await setSettings({ signups_open: 0 });
    const result = await getOrCreatePlayer(
      { db, playerService: await buildService(db, new Set(['did:plc:elf'])) },
      'did:plc:elf',
      'bluesky',
      {}
    );
    const stored = await db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', 'did:plc:elf')
      .executeTakeFirst();
    expect(stored).toBeDefined();
    expect(result.player?.did).toBe('did:plc:elf');
  });

  it('stores provided mastodon attributes on created mastodon players', async () => {
    await setSettings({ signups_open: 1, mastodon_players: 1 });
    const result = await getOrCreatePlayer(
      { db, playerService: await buildService(db) },
      'did:plc:masto-user',
      'mastodon',
      {
        mastodon_account: 'user@instance.social',
        mastodon_host: 'instance.social',
      }
    );
    const stored = await db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', 'did:plc:masto-user')
      .executeTakeFirstOrThrow();
    expect(stored.mastodon_account).toBe('user@instance.social');
    expect(result.player?.player_type).toBe('mastodon');
  });
});
