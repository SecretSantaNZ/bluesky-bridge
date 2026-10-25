import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const newrelicMock = vi.hoisted(() => ({
  recordCustomEvent: vi.fn(),
  noticeError: vi.fn(),
}));

// The mastodon DM goes out through `safeFetchWrap` (real undici SSRF-protected
// fetch), which can't be intercepted by msw, so capture the posting at the
// fetch layer instead.
const mastodonPosts = vi.hoisted(
  () => [] as Array<{ url: string; body: unknown }>
);
vi.mock('newrelic', () => ({
  default: newrelicMock,
  ...newrelicMock,
}));

vi.mock('@atproto-labs/fetch-node', () => ({
  safeFetchWrap: () => async (url: string | URL, init?: { body?: unknown }) => {
    mastodonPosts.push({ url: String(url), body: init?.body });
    return new Response(JSON.stringify({ id: '1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
}));

import { Agent } from '@atproto/api';
import { createDb, migrateToLatest, type Database } from './database/index.js';
import { DmSender } from './DmSender.js';

// A fake "now" that falls inside the 9AM-8PM NZT sending window.
const inWindowTime = new Date('2025-12-25T23:00:00.000Z');

const postedMastodonStatuses = (): Array<Record<string, unknown>> =>
  mastodonPosts.map(({ body }) =>
    typeof body === 'string' ? JSON.parse(body) : body
  );

const santaMastodonHandle = 'santa@mastodon.social';
const santaMastodonHost = 'mastodon.social';

async function setupDb() {
  const db = createDb();
  await migrateToLatest(db);
  await db
    .updateTable('settings')
    .set({ nudge_rate: '1 hour', dm_rate: '1 hour', send_messages: 1 })
    .where('id', '=', 0)
    .execute();
  return db;
}

type PlayerOverrides = Partial<{
  did: string;
  handle: string;
  player_type: 'bluesky' | 'mastodon';
  mastodon_account: string | null;
  mastodon_host: string | null;
  game_mode: null | 'Regular' | 'Super Santa' | 'Santa Only' | 'Giftee Only';
  address: string | null;
  delivery_instructions: string | null;
  following_santa_uri: string | null;
  next_player_dm:
    | null
    | 'signup-complete-1'
    | 'signup-complete-2'
    | 'signup-complete-3'
    | 'signup-complete-4'
    | 'poke-inactive';
  next_player_dm_after: string | null;
}>;

async function insertPlayer(db: Database, overrides: PlayerOverrides = {}) {
  const { next_player_dm, next_player_dm_after, ...rest } = overrides;
  const did = rest.did ?? 'did:plc:player';
  await db
    .insertInto('player')
    .values({
      did,
      handle: rest.handle ?? 'player.bsky.social',
      player_type: 'bluesky',
      max_giftees: 3,
      giftee_count: 0,
      profile_complete: 1,
      signup_complete: 1,
      address: '123 Main St',
      game_mode: 'Regular',
      following_santa_uri: 'at://did:plc:santa/app.bsky.graph.follow/1',
      avatar_url: 'https://example.com/player.jpg',
      note_count: 0,
      ...rest,
    })
    .execute();

  await db
    .updateTable('player')
    .set({
      player_dm_status: 'queued',
      ...(next_player_dm !== undefined ? { next_player_dm } : {}),
      ...(next_player_dm_after !== undefined ? { next_player_dm_after } : {}),
    })
    .where('did', '=', did)
    .execute();

  return await db
    .selectFrom('player')
    .selectAll()
    .where('did', '=', did)
    .executeTakeFirstOrThrow();
}

type MatchOverrides = Partial<{
  match_status: 'draft' | 'shared' | 'locked';
}>;

async function insertMatch(
  db: Database,
  santaId: number,
  gifteeId: number,
  overrides: MatchOverrides = {}
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

async function insertTracking(
  db: Database,
  matchId: number,
  overrides: Partial<{
    carrier: number;
    tracking_number: string;
    giftwrap_status: number;
  }> = {}
) {
  return await db
    .insertInto('tracking')
    .values({
      match: matchId,
      carrier: overrides.carrier ?? 1,
      shipped_date: '2025-12-20',
      tracking_number: overrides.tracking_number ?? 'ABC123',
      giftwrap_status: overrides.giftwrap_status ?? 1,
      missing: null,
      tracking_status: 'queued',
      created_at: '2025-12-20T00:00:00Z',
      created_by: 'did:plc:santa',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function getCarrierId(db: Database, carrierName: string) {
  const carrier = await db
    .selectFrom('carrier')
    .selectAll()
    .where('text', '=', carrierName)
    .executeTakeFirstOrThrow();
  return carrier.id;
}

function createAgent(did = 'did:plc:santa-agent') {
  const getConvoForMembers = vi.fn().mockResolvedValue({
    data: { convo: { id: 'convo1' } },
  });
  const sendMessage = vi.fn().mockResolvedValue({});
  const resolveHandle = vi.fn().mockResolvedValue({
    data: { did: 'did:plc:resolved' },
  });
  const agent = {
    sessionManager: { did },
    com: {
      atproto: {
        identity: { resolveHandle },
      },
    },
    api: {
      chat: {
        bsky: {
          convo: {
            getConvoForMembers,
            sendMessage,
          },
        },
      },
    },
  } as unknown as Agent;
  return { agent, getConvoForMembers, sendMessage, resolveHandle };
}

async function insertMastodonToken(db: Database) {
  await db
    .insertInto('mastodon_token')
    .values({
      account: santaMastodonHandle,
      mastodon_id: '1',
      token: 'mastodon-token',
      client_id: 'client-id',
      issued_at: '2025-12-01T00:00:00Z',
    })
    .execute();
}

describe('DmSender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mastodonPosts.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('settingsChanged', () => {
    it('starts interval when send_messages is true', async () => {
      const db = await setupDb();
      const santaAgent = vi.fn().mockResolvedValue({});

      const sender = new DmSender(
        db,
        santaAgent,
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.init();
      await vi.waitFor(() => {
        expect(vi.getTimerCount()).toBeGreaterThan(0);
      });
    });

    it('clears interval when send_messages becomes false', async () => {
      const db = await setupDb();
      const santaAgent = vi.fn().mockResolvedValue({});

      const sender = new DmSender(
        db,
        santaAgent,
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.init();
      await vi.waitFor(() => {
        expect(vi.getTimerCount()).toBeGreaterThan(0);
      });

      await sender.settingsChanged({ dm_rate: '1 hour', send_messages: 0 });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('sendADm', () => {
    it('skips dms outside of time window', async () => {
      const db = await setupDb();
      const santaAgent = vi.fn().mockResolvedValue({});
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      vi.setSystemTime(new Date('2025-12-25T19:00:00Z'));
      const sender = new DmSender(
        db,
        santaAgent,
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'skipping dm, outside of time'
      );
    });

    it('proceeds within time window and checks for dm', async () => {
      const db = await setupDb();
      const { agent: santaAgent, sendMessage } = createAgent();
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();
      expect(consoleLogSpy).toHaveBeenCalledWith('checking for dm to send');
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('returns early if no dm found in any queue', async () => {
      const db = await setupDb();
      const { agent: santaAgent, sendMessage } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      expect(sendMessage).not.toHaveBeenCalled();
      expect(newrelicMock.recordCustomEvent).not.toHaveBeenCalled();
    });

    it('processes signupComplete1DMQueue and advances the queue', async () => {
      const db = await setupDb();
      await db
        .updateTable('settings')
        .set({ elf_list: '@elves.bsky.social' })
        .where('id', '=', 0)
        .execute();
      const player = await insertPlayer(db, {
        did: 'did:plc:alice',
        handle: 'alice.bsky.social',
      });
      const { agent: santaAgent, sendMessage } = createAgent();
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();
      consoleLogSpy.mockRestore();

      expect(sendMessage).toHaveBeenCalled();
      const messageCall = sendMessage.mock.calls[0]![0];
      expect(messageCall.message.text).toContain(
        "you're all signed up and ready to play "
      );
      expect(messageCall.message.text).toContain('@elves.bsky.social');
      expect(messageCall.message.text).toContain('[Sent by 🤖]');

      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('id', '=', player.id)
        .executeTakeFirstOrThrow();
      expect(updatedPlayer.next_player_dm).toBe('signup-complete-2');
      expect(updatedPlayer.next_player_dm_after).toBe(
        '2025-12-26T17:00:00.000Z'
      );
      expect(newrelicMock.recordCustomEvent).toHaveBeenCalledWith(
        'SecretSantaDMSent',
        expect.objectContaining({
          recipientDid: 'did:plc:alice',
          dmType: 'signup-complete-1',
        })
      );
    });

    it('processes signupComplete2DMQueue and schedules signup-complete-4 for Santa Only player', async () => {
      const db = await setupDb();
      const player = await insertPlayer(db, {
        did: 'did:plc:carol',
        handle: 'carol.bsky.social',
        game_mode: 'Santa Only',
        next_player_dm: 'signup-complete-2',
        next_player_dm_after: '2025-12-01T00:00:00.000Z',
      });
      const { agent: santaAgent, sendMessage } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      expect(sendMessage).toHaveBeenCalled();
      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('id', '=', player.id)
        .executeTakeFirstOrThrow();
      expect(updatedPlayer.next_player_dm).toBe('signup-complete-4');
      expect(updatedPlayer.next_player_dm_after).toBe('2025-12-26T17:00:00Z');
    });

    it('processes signupComplete2DMQueue and schedules signup-complete-3 for Regular player', async () => {
      const db = await setupDb();
      const player = await insertPlayer(db, {
        did: 'did:plc:eve',
        handle: 'eve.bsky.social',
        next_player_dm: 'signup-complete-2',
        next_player_dm_after: '2025-12-01T00:00:00.000Z',
      });
      const { agent: santaAgent, sendMessage } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      expect(sendMessage).toHaveBeenCalled();
      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('id', '=', player.id)
        .executeTakeFirstOrThrow();
      expect(updatedPlayer.next_player_dm).toBe('signup-complete-3');
    });

    it('uses beforeMatchDay for next dm when the interval is earlier than it', async () => {
      const db = await setupDb();
      await db
        .updateTable('settings')
        .set({ matches_sent_date: '2025-12-20' })
        .where('id', '=', 0)
        .execute();
      const player = await insertPlayer(db, {
        did: 'did:plc:henry',
        handle: 'henry.bsky.social',
        game_mode: 'Santa Only',
        next_player_dm: 'signup-complete-2',
        next_player_dm_after: '2025-11-01T00:00:00.000Z',
      });
      const { agent: santaAgent, sendMessage } = createAgent();

      vi.setSystemTime(new Date('2025-11-01T23:00:00.000Z'));
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      expect(sendMessage).toHaveBeenCalled();
      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('id', '=', player.id)
        .executeTakeFirstOrThrow();
      expect(updatedPlayer.next_player_dm).toBe('signup-complete-4');
      expect(
        updatedPlayer.next_player_dm_after?.startsWith('2025-12-18T11:00:00')
      ).toBe(true);
    });

    it('processes signupComplete3DMQueue with delivery instructions and address', async () => {
      const db = await setupDb();
      const player = await insertPlayer(db, {
        did: 'did:plc:frank',
        handle: 'frank.bsky.social',
        delivery_instructions: 'Leave at door',
        next_player_dm: 'signup-complete-3',
        next_player_dm_after: '2025-12-01T00:00:00.000Z',
      });
      const { agent: santaAgent, sendMessage } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      expect(sendMessage).toHaveBeenCalled();
      const messageCall = sendMessage.mock.calls[0]![0];
      expect(messageCall.message.text).toContain(
        'Leave at door\n\n123 Main St'
      );

      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('id', '=', player.id)
        .executeTakeFirstOrThrow();
      expect(updatedPlayer.next_player_dm).toBe('signup-complete-4');
    });

    it('processes signupComplete3DMQueue with no delivery instructions', async () => {
      const db = await setupDb();
      const player = await insertPlayer(db, {
        did: 'did:plc:iris',
        handle: 'iris.bsky.social',
        delivery_instructions: null,
        next_player_dm: 'signup-complete-3',
        next_player_dm_after: '2025-12-01T00:00:00.000Z',
      });
      const { agent: santaAgent, sendMessage } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      expect(sendMessage).toHaveBeenCalled();
      const messageCall = sendMessage.mock.calls[0]![0];
      expect(messageCall.message.text).toContain('123 Main St');

      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('id', '=', player.id)
        .executeTakeFirstOrThrow();
      expect(updatedPlayer.next_player_dm).toBe('signup-complete-4');
    });

    it('processes signupComplete4DMQueue and marks the dm queue as sent', async () => {
      const db = await setupDb();
      const player = await insertPlayer(db, {
        did: 'did:plc:grace',
        handle: 'grace.bsky.social',
        next_player_dm: 'signup-complete-4',
        next_player_dm_after: '2025-12-01T00:00:00.000Z',
      });
      const { agent: santaAgent, sendMessage } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      expect(sendMessage).toHaveBeenCalled();
      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('id', '=', player.id)
        .executeTakeFirstOrThrow();
      expect(updatedPlayer.next_player_dm).toBeNull();
      expect(updatedPlayer.player_dm_status).toBe('sent');
    });

    it('processes pokeInactiveDMQueue for players following santa', async () => {
      const db = await setupDb();
      await db
        .updateTable('settings')
        .set({ elf_list: '@elves.bsky.social' })
        .where('id', '=', 0)
        .execute();
      const player = await insertPlayer(db, {
        did: 'did:plc:bob',
        handle: 'bob.bsky.social',
        next_player_dm: 'poke-inactive',
        next_player_dm_after: '2025-12-01T00:00:00.000Z',
      });
      const { agent: santaAgent, sendMessage } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      expect(sendMessage).toHaveBeenCalled();
      const messageCall = sendMessage.mock.calls[0]![0];
      expect(messageCall.message.text).toContain(
        'Opening day is fast approaching'
      );

      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('id', '=', player.id)
        .executeTakeFirstOrThrow();
      expect(updatedPlayer.next_player_dm).toBeNull();
      expect(updatedPlayer.player_dm_status).toBe('sent');
    });

    it('processes matchHandleDMQueue for a bluesky santa with an unbridged giftee', async () => {
      const db = await setupDb();
      const santa = await insertPlayer(db, {
        did: 'did:plc:santa',
        handle: 'santa.bsky.social',
        next_player_dm: null,
      });
      const giftee = await insertPlayer(db, {
        did: 'did:plc:giftee',
        handle: 'giftee.bsky.social',
        next_player_dm: null,
      });
      const match = await insertMatch(db, santa.id, giftee.id);
      const { agent: santaAgent, sendMessage } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();
      expect(sendMessage).toHaveBeenCalled();
      const messageCall = sendMessage.mock.calls[0]![0];
      expect(messageCall.message.text).toContain('@giftee.bsky.social');
      expect(messageCall.message.text).toContain('[Sent by 🤖]');

      const updatedMatch = await db
        .selectFrom('match')
        .selectAll()
        .where('id', '=', match.id)
        .executeTakeFirstOrThrow();
      expect(updatedMatch.dm_handle_status).toBe('sent');
    });

    it('processes matchHandleDMQueue for a mastodon santa with a bridged giftee', async () => {
      const db = await setupDb();
      const santa = await insertPlayer(db, {
        did: 'did:plc:santa',
        handle: 'santa.bsky.social',
        player_type: 'mastodon',
        mastodon_account: santaMastodonHandle,
        mastodon_host: santaMastodonHost,
        next_player_dm: null,
      });
      const giftee = await insertPlayer(db, {
        did: 'did:plc:giftee',
        handle: 'giftee.bsky.social',
        mastodon_account: 'giftee@mastodon.social',
        next_player_dm: null,
      });
      const match = await insertMatch(db, santa.id, giftee.id);
      await insertMastodonToken(db);
      const { agent: santaAgent } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      const postedStatuses = postedMastodonStatuses();
      expect(postedStatuses).toHaveLength(1);
      expect(postedStatuses[0]!.status).toContain('giftee@mastodon.social');
      expect(postedStatuses[0]!.visibility).toBe('direct');

      const updatedMatch = await db
        .selectFrom('match')
        .selectAll()
        .where('id', '=', match.id)
        .executeTakeFirstOrThrow();
      expect(updatedMatch.dm_handle_status).toBe('sent');
    });

    it('processes matchHandleDMQueue for a mastodon santa with an unbridged giftee', async () => {
      const db = await setupDb();
      const santa = await insertPlayer(db, {
        did: 'did:plc:santa',
        handle: 'santa.bsky.social',
        player_type: 'mastodon',
        mastodon_account: santaMastodonHandle,
        mastodon_host: santaMastodonHost,
        next_player_dm: null,
      });
      const giftee = await insertPlayer(db, {
        did: 'did:plc:giftee',
        handle: 'giftee.bsky.social',
        mastodon_account: null,
        next_player_dm: null,
      });
      await insertMatch(db, santa.id, giftee.id);
      await insertMastodonToken(db);
      const { agent: santaAgent } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      const postedStatuses = postedMastodonStatuses();
      expect(postedStatuses).toHaveLength(1);
      expect(postedStatuses[0]!.status).toContain(
        'https://bsky.app/profile/giftee.bsky.social'
      );
    });

    it('processes matchAddressDMQueue', async () => {
      const db = await setupDb();
      const santa = await insertPlayer(db, {
        did: 'did:plc:santa',
        handle: 'santa.bsky.social',
        next_player_dm: null,
      });
      const giftee = await insertPlayer(db, {
        did: 'did:plc:giftee',
        handle: 'giftee.bsky.social',
        delivery_instructions: 'Ring doorbell',
        address: '456 Oak Ave',
        next_player_dm: null,
      });
      const match = await insertMatch(db, santa.id, giftee.id, {
        match_status: 'locked',
      });
      const { agent: santaAgent, sendMessage } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      expect(sendMessage).toHaveBeenCalled();
      const messageCall = sendMessage.mock.calls[0]![0];
      expect(messageCall.message.text).toContain(
        'Ring doorbell\n\n456 Oak Ave'
      );

      const updatedMatch = await db
        .selectFrom('match')
        .selectAll()
        .where('id', '=', match.id)
        .executeTakeFirstOrThrow();
      expect(updatedMatch.dm_address_status).toBe('sent');
    });

    it('processes trackingDMQueue with giftwrap message', async () => {
      const db = await setupDb();
      const carrierId = await getCarrierId(db, 'NZ Post');
      const santa = await insertPlayer(db, {
        did: 'did:plc:santa',
        handle: 'santa.bsky.social',
        next_player_dm: null,
      });
      const giftee = await insertPlayer(db, {
        did: 'did:plc:giftee',
        handle: 'giftee.bsky.social',
        next_player_dm: null,
      });
      const match = await insertMatch(db, santa.id, giftee.id);
      // The queues are round-robin; skip the match-handle dm so that the
      // tracking dm is the one under test.
      await db
        .updateTable('match')
        .set({ dm_handle_status: 'sent' })
        .where('id', '=', match.id)
        .execute();
      const tracking = await insertTracking(db, match.id, {
        carrier: carrierId,
        tracking_number: 'ABC123',
        giftwrap_status: 1,
      });
      const { agent: santaAgent, sendMessage } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      expect(sendMessage).toHaveBeenCalled();
      const messageCall = sendMessage.mock.calls[0]![0];
      expect(messageCall.message.text).toContain('ABC123');
      expect(messageCall.message.text).toContain(
        'safe to remove the outer layer'
      );

      const updatedTracking = await db
        .selectFrom('tracking')
        .selectAll()
        .where('id', '=', tracking.id)
        .executeTakeFirstOrThrow();
      expect(updatedTracking.tracking_status).toBe('sent');
    });

    it('processes trackingDMQueue with no giftwrap', async () => {
      const db = await setupDb();
      const carrierId = await getCarrierId(db, 'NZ Post');
      const santa = await insertPlayer(db, {
        did: 'did:plc:santa',
        handle: 'santa.bsky.social',
        next_player_dm: null,
      });
      const giftee = await insertPlayer(db, {
        did: 'did:plc:giftee',
        handle: 'giftee.bsky.social',
        next_player_dm: null,
      });
      const match = await insertMatch(db, santa.id, giftee.id);
      // The queues are round-robin; skip the match-handle dm so that the
      // tracking dm is the one under test.
      await db
        .updateTable('match')
        .set({ dm_handle_status: 'sent' })
        .where('id', '=', match.id)
        .execute();
      await insertTracking(db, match.id, {
        carrier: carrierId,
        tracking_number: 'XYZ789',
        giftwrap_status: 0,
      });
      const { agent: santaAgent, sendMessage } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      const messageCall = sendMessage.mock.calls[0]![0];
      expect(messageCall.message.text).toContain('XYZ789');
      expect(messageCall.message.text).toContain(
        'do not remove the postal packaging'
      );
    });

    it('handles sendDm error in sendADm gracefully and marks the record as errored', async () => {
      const db = await setupDb();
      const player = await insertPlayer(db, {
        did: 'did:plc:alice',
        handle: 'alice.bsky.social',
      });
      const {
        agent: santaAgent,
        getConvoForMembers,
        sendMessage,
      } = createAgent();
      getConvoForMembers.mockRejectedValue(new Error('API error'));
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      expect(sendMessage).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(newrelicMock.noticeError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'API error' }),
        expect.anything()
      );

      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('id', '=', player.id)
        .executeTakeFirstOrThrow();
      expect(updatedPlayer.player_dm_status).toBe('error: API error');
    });

    it('sends a mastodon dm successfully', async () => {
      const db = await setupDb();
      const player = await insertPlayer(db, {
        did: 'did:plc:dave',
        handle: 'dave.mastodon.social',
        player_type: 'mastodon',
        mastodon_account: 'dave@mastodon.social',
      });
      await insertMastodonToken(db);
      const { agent: santaAgent } = createAgent();

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      const postedStatuses = postedMastodonStatuses();
      expect(postedStatuses).toHaveLength(1);
      expect(postedStatuses[0]!.status).toContain('@dave@mastodon.social');
      expect(postedStatuses[0]!.visibility).toBe('direct');
      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('id', '=', player.id)
        .executeTakeFirstOrThrow();
      expect(updatedPlayer.next_player_dm).toBe('signup-complete-2');
    });

    it('marks sent and returns when sending to self', async () => {
      const db = await setupDb();
      const player = await insertPlayer(db, {
        did: 'did:plc:alice',
        handle: 'alice.bsky.social',
      });
      const { agent: santaAgent, getConvoForMembers } =
        createAgent('did:plc:alice');

      vi.setSystemTime(inWindowTime);
      const sender = new DmSender(
        db,
        senderAgent(santaAgent),
        santaMastodonHandle,
        santaMastodonHost
      );
      await sender.sendADm();

      expect(getConvoForMembers).not.toHaveBeenCalled();
      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('id', '=', player.id)
        .executeTakeFirstOrThrow();
      expect(updatedPlayer.next_player_dm).toBe('signup-complete-2');
    });
  });
});

// Wrap with a tiny helper so each test's agent factory reads clearly, and so
// the mocked agent satisfies the constructor signature.
function senderAgent(agent: Agent) {
  return async () => agent;
}
