import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('newrelic', () => ({
  default: {
    recordCustomEvent: vi.fn(),
    noticeError: vi.fn(),
  },
  recordCustomEvent: vi.fn(),
  noticeError: vi.fn(),
}));

vi.mock('@atproto/api', () => {
  const RichText = vi.fn().mockImplementation((opts: { text: string }) => ({
    text: opts.text,
    facets: [],
    detectFacets: vi.fn().mockResolvedValue(undefined),
  }));
  return { RichText };
});

import { NudgeSender } from './NudgeSender.js';
import { RichText } from '@atproto/api';
import * as newrelic from 'newrelic';
import { createDb, migrateToLatest } from './database/index.js';

const mockedRichText = vi.mocked(RichText);
const mockedNewrelic = newrelic as unknown as {
  recordCustomEvent: Mock;
  noticeError: Mock;
  default?: {
    recordCustomEvent?: Mock;
    noticeError?: Mock;
  };
};

describe('NudgeSender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('settingsChanged', () => {
    it('starts interval when send_messages is true', async () => {
      const db = createDb();
      await migrateToLatest(db);
      await db
        .updateTable('settings')
        .set({ nudge_rate: '1 hour', send_messages: 1 })
        .where('id', '=', 0)
        .execute();
      const robotAgent = vi.fn().mockResolvedValue({});
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      const sender = new NudgeSender(db, robotAgent);
      await sender.init();
      await vi.waitFor(() => {
        expect(setIntervalSpy).toHaveBeenCalled();
      });
    });

    it('clears interval when send_messages becomes false', async () => {
      const db = createDb();
      await migrateToLatest(db);
      await db
        .updateTable('settings')
        .set({ nudge_rate: '1 hour', send_messages: 1 })
        .where('id', '=', 0)
        .execute();
      const robotAgent = vi.fn().mockResolvedValue({});
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const sender = new NudgeSender(db, robotAgent);
      await sender.init();
      await vi.waitFor(() => {
        expect(vi.getTimerCount()).toBeGreaterThan(0);
      });

      await sender.settingsChanged({ nudge_rate: '1 hour', send_messages: 0 });
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('restarts interval when nudge_rate changes', async () => {
      const db = createDb();
      await migrateToLatest(db);
      await db
        .updateTable('settings')
        .set({ nudge_rate: '1 hour', send_messages: 1 })
        .where('id', '=', 0)
        .execute();
      const robotAgent = vi.fn().mockResolvedValue({});
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      const sender = new NudgeSender(db, robotAgent);
      await sender.init();
      await vi.waitFor(() => {
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      });

      await sender.settingsChanged({
        nudge_rate: '30 minutes',
        send_messages: 1,
      });
      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendANudge', () => {
    it('skips nudges outside of time window (before 9 AM NZT)', async () => {
      const db = createDb();
      await migrateToLatest(db);
      await db
        .updateTable('settings')
        .set({ nudge_rate: '1 hour', send_messages: 1 })
        .where('id', '=', 0)
        .execute();
      const robotAgent = vi.fn().mockResolvedValue({});
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      vi.setSystemTime(new Date('2025-12-25T19:00:00Z'));
      const sender = new NudgeSender(db, robotAgent);
      await sender.sendANudge();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'skipping nudges, outside of time'
      );
    });

    it('skips nudges outside of time window (after 8 PM NZT)', async () => {
      const db = createDb();
      await migrateToLatest(db);
      await db
        .updateTable('settings')
        .set({ nudge_rate: '1 hour', send_messages: 1 })
        .where('id', '=', 0)
        .execute();
      const robotAgent = vi.fn().mockResolvedValue({});
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      vi.setSystemTime(new Date('2025-12-25T08:00:00Z'));
      const sender = new NudgeSender(db, robotAgent);
      await sender.sendANudge();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'skipping nudges, outside of time'
      );
    });

    it('proceeds within time window', async () => {
      const db = createDb();
      await migrateToLatest(db);
      await db
        .updateTable('settings')
        .set({ nudge_rate: '1 hour', send_messages: 1 })
        .where('id', '=', 0)
        .execute();
      const robotAgent = vi.fn().mockResolvedValue({});
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      vi.setSystemTime(new Date('2025-12-25T23:00:00Z'));
      const sender = new NudgeSender(db, robotAgent);
      await sender.sendANudge();
      expect(consoleLogSpy).toHaveBeenCalledWith('checking for nudges to send');
    });

    it('returns early if no queued nudges', async () => {
      const db = createDb();
      await migrateToLatest(db);
      await db
        .updateTable('settings')
        .set({ nudge_rate: '1 hour', send_messages: 1 })
        .where('id', '=', 0)
        .execute();
      const robotAgent = vi.fn().mockResolvedValue({});

      vi.setSystemTime(new Date('2025-12-25T23:00:00Z'));
      const sender = new NudgeSender(db, robotAgent);
      await sender.sendANudge();
    });

    it('builds and sends a regular nudge', async () => {
      const db = createDb();
      await migrateToLatest(db);
      await db
        .updateTable('settings')
        .set({
          nudge_rate: '1 hour',
          send_messages: 1,
          hashtag: '#secretsanta',
        })
        .where('id', '=', 0)
        .execute();

      const santa = await db
        .insertInto('player')
        .values({
          did: 'did:plc:santa',
          handle: 'santa.bsky.social',
          player_type: 'bluesky',
          max_giftees: 1,
          giftee_count: 0,
          profile_complete: 1,
          signup_complete: 1,
          address: '1 St',
          game_mode: 'Regular',
          following_santa_uri: 'at://x/y/1',
          avatar_url: 's.jpg',
          note_count: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const giftee = await db
        .insertInto('player')
        .values({
          did: 'did:plc:giftee',
          handle: 'giftee.bsky.social',
          player_type: 'bluesky',
          max_giftees: 1,
          giftee_count: 0,
          profile_complete: 1,
          signup_complete: 1,
          address: '2 St',
          game_mode: 'Regular',
          following_santa_uri: 'at://x/y/2',
          avatar_url: 'g.jpg',
          note_count: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const match = await db
        .insertInto('match')
        .values({
          santa: santa.id,
          giftee: giftee.id,
          has_present: 0,
          invalid_player: 0,
          match_status: 'shared',
          nudge_count: 0,
          nudge_present_update_count: 0,
          tracking_count: 0,
          tracking_missing_count: 0,
          super_santa_match: 0,
          posted_opening: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const nudgeType = await db
        .selectFrom('nudge_type')
        .selectAll()
        .where('name', '=', 'Hint')
        .executeTakeFirstOrThrow();

      const greeting = await db
        .insertInto('nudge_greeting')
        .values({ text: 'Hello' })
        .returningAll()
        .executeTakeFirstOrThrow();

      const signoff = await db
        .insertInto('nudge_signoff')
        .values({ text: 'Good luck!' })
        .returningAll()
        .executeTakeFirstOrThrow();

      await db
        .insertInto('nudge_type_greeting')
        .values({ nudge_type: nudgeType.id, greeting: greeting.id })
        .execute();

      await db
        .insertInto('nudge_type_signoff')
        .values({ nudge_type: nudgeType.id, signoff: signoff.id })
        .execute();

      await db
        .insertInto('nudge')
        .values({
          nudge_type: nudgeType.id,
          nudge_greeting: greeting.id,
          nudge_signoff: signoff.id,
          match: match.id,
          nudge_status: 'queued',
          created_at: '2025-12-01T00:00:00Z',
          created_by: 'did:plc:santa',
        })
        .execute();

      const postMock = vi.fn().mockResolvedValue({
        uri: 'at://did:plc:santa/app.bsky.feed.post/abc123',
      });
      const robotAgent = vi.fn().mockResolvedValue({ post: postMock });

      vi.setSystemTime(new Date('2025-12-25T23:00:00Z'));
      const sender = new NudgeSender(db, robotAgent);
      await sender.sendANudge();

      expect(mockedRichText).toHaveBeenCalled();
      expect(postMock).toHaveBeenCalled();

      const richTextCall = mockedRichText.mock.calls[0]![0] as {
        text: string;
      };
      expect(richTextCall.text).toContain('Hello @giftee.bsky.social.');
      expect(richTextCall.text).toContain('Good luck!');
      expect(richTextCall.text).toContain('[Sent by 🤖]');

      const updatedNudge = await db
        .selectFrom('nudge')
        .selectAll()
        .executeTakeFirstOrThrow();
      expect(updatedNudge.nudge_status).toBe('sent');
      expect(updatedNudge.post_url).toBe(
        'https://bsky.app/profile/did:plc:santa/post/abc123'
      );
      expect(mockedNewrelic.default?.recordCustomEvent).toHaveBeenCalled();
    });

    it('appends hint idea for hint type when message is short enough', async () => {
      const db = createDb();
      await migrateToLatest(db);
      await db
        .updateTable('settings')
        .set({ nudge_rate: '1 hour', send_messages: 1 })
        .where('id', '=', 0)
        .execute();

      const santa = await db
        .insertInto('player')
        .values({
          did: 'did:plc:santa',
          handle: 'santa.bsky.social',
          player_type: 'bluesky',
          max_giftees: 1,
          giftee_count: 0,
          profile_complete: 1,
          signup_complete: 1,
          address: '1 St',
          game_mode: 'Regular',
          following_santa_uri: 'at://x/y/1',
          avatar_url: 's.jpg',
          note_count: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const giftee = await db
        .insertInto('player')
        .values({
          did: 'did:plc:giftee',
          handle: 'giftee.bsky.social',
          player_type: 'bluesky',
          max_giftees: 1,
          giftee_count: 0,
          profile_complete: 1,
          signup_complete: 1,
          address: '2 St',
          game_mode: 'Regular',
          following_santa_uri: 'at://x/y/2',
          avatar_url: 'g.jpg',
          note_count: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const match = await db
        .insertInto('match')
        .values({
          santa: santa.id,
          giftee: giftee.id,
          has_present: 0,
          invalid_player: 0,
          match_status: 'shared',
          nudge_count: 0,
          nudge_present_update_count: 0,
          tracking_count: 0,
          tracking_missing_count: 0,
          super_santa_match: 0,
          posted_opening: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const nudgeType = await db
        .selectFrom('nudge_type')
        .selectAll()
        .where('name', '=', 'Hint')
        .executeTakeFirstOrThrow();

      const greeting = await db
        .insertInto('nudge_greeting')
        .values({ text: 'Hi' })
        .returningAll()
        .executeTakeFirstOrThrow();

      const signoff = await db
        .insertInto('nudge_signoff')
        .values({ text: 'Cheers' })
        .returningAll()
        .executeTakeFirstOrThrow();

      await db
        .insertInto('nudge_type_greeting')
        .values({ nudge_type: nudgeType.id, greeting: greeting.id })
        .execute();

      await db
        .insertInto('nudge_type_signoff')
        .values({ nudge_type: nudgeType.id, signoff: signoff.id })
        .execute();

      await db
        .insertInto('nudge')
        .values({
          nudge_type: nudgeType.id,
          nudge_greeting: greeting.id,
          nudge_signoff: signoff.id,
          match: match.id,
          nudge_status: 'queued',
          created_at: '2025-12-01T00:00:00Z',
          created_by: 'did:plc:santa',
        })
        .execute();

      const postMock = vi.fn().mockResolvedValue({
        uri: 'at://did:plc:santa/app.bsky.feed.post/xyz789',
      });
      const robotAgent = vi.fn().mockResolvedValue({ post: postMock });

      vi.setSystemTime(new Date('2025-12-25T23:00:00Z'));
      const sender = new NudgeSender(db, robotAgent);
      await sender.sendANudge();

      const richTextCall = mockedRichText.mock.calls[0]![0];
      expect(richTextCall.text).toContain('Not sure what to say? How about:');
    });

    it('does not append hint idea for hint type when message is too long', async () => {
      const db = createDb();
      await migrateToLatest(db);
      await db
        .updateTable('settings')
        .set({ nudge_rate: '1 hour', send_messages: 1 })
        .where('id', '=', 0)
        .execute();

      const santa = await db
        .insertInto('player')
        .values({
          did: 'did:plc:santa',
          handle: 'santa.bsky.social',
          player_type: 'bluesky',
          max_giftees: 1,
          giftee_count: 0,
          profile_complete: 1,
          signup_complete: 1,
          address: '1 St',
          game_mode: 'Regular',
          following_santa_uri: 'at://x/y/1',
          avatar_url: 's.jpg',
          note_count: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const giftee = await db
        .insertInto('player')
        .values({
          did: 'did:plc:giftee',
          handle: 'giftee.bsky.social',
          player_type: 'bluesky',
          max_giftees: 1,
          giftee_count: 0,
          profile_complete: 1,
          signup_complete: 1,
          address: '2 St',
          game_mode: 'Regular',
          following_santa_uri: 'at://x/y/2',
          avatar_url: 'g.jpg',
          note_count: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const match = await db
        .insertInto('match')
        .values({
          santa: santa.id,
          giftee: giftee.id,
          has_present: 0,
          invalid_player: 0,
          match_status: 'shared',
          nudge_count: 0,
          nudge_present_update_count: 0,
          tracking_count: 0,
          tracking_missing_count: 0,
          super_santa_match: 0,
          posted_opening: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const nudgeType = await db
        .selectFrom('nudge_type')
        .selectAll()
        .where('name', '=', 'Hint')
        .executeTakeFirstOrThrow();

      const greeting = await db
        .insertInto('nudge_greeting')
        .values({ text: 'Hi' })
        .returningAll()
        .executeTakeFirstOrThrow();

      const signoff = await db
        .insertInto('nudge_signoff')
        .values({ text: 'Cheers' })
        .returningAll()
        .executeTakeFirstOrThrow();

      await db
        .insertInto('nudge_type_greeting')
        .values({ nudge_type: nudgeType.id, greeting: greeting.id })
        .execute();

      await db
        .insertInto('nudge_type_signoff')
        .values({ nudge_type: nudgeType.id, signoff: signoff.id })
        .execute();

      await db
        .deleteFrom('message')
        .where('message_type', '=', 'nudge-hint')
        .execute();
      await db
        .insertInto('message')
        .values({
          message_type: 'nudge-hint',
          message: 'a'.repeat(300),
        })
        .execute();

      await db
        .insertInto('nudge')
        .values({
          nudge_type: nudgeType.id,
          nudge_greeting: greeting.id,
          nudge_signoff: signoff.id,
          match: match.id,
          nudge_status: 'queued',
          created_at: '2025-12-01T00:00:00Z',
          created_by: 'did:plc:santa',
        })
        .execute();

      const postMock = vi.fn().mockResolvedValue({
        uri: 'at://did:plc:santa/app.bsky.feed.post/xyz789',
      });
      const robotAgent = vi.fn().mockResolvedValue({ post: postMock });

      vi.setSystemTime(new Date('2025-12-25T23:00:00Z'));
      const sender = new NudgeSender(db, robotAgent);
      await sender.sendANudge();

      const richTextCall = mockedRichText.mock.calls[0]![0];
      expect(richTextCall.text).not.toContain('Not sure what to say?');
    });

    it('handles send error and updates nudge status', async () => {
      const db = createDb();
      await migrateToLatest(db);
      await db
        .updateTable('settings')
        .set({ nudge_rate: '1 hour', send_messages: 1 })
        .where('id', '=', 0)
        .execute();

      const santa = await db
        .insertInto('player')
        .values({
          did: 'did:plc:santa',
          handle: 'santa.bsky.social',
          player_type: 'bluesky',
          max_giftees: 1,
          giftee_count: 0,
          profile_complete: 1,
          signup_complete: 1,
          address: '1 St',
          game_mode: 'Regular',
          following_santa_uri: 'at://x/y/1',
          avatar_url: 's.jpg',
          note_count: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const giftee = await db
        .insertInto('player')
        .values({
          did: 'did:plc:giftee',
          handle: 'giftee.bsky.social',
          player_type: 'bluesky',
          max_giftees: 1,
          giftee_count: 0,
          profile_complete: 1,
          signup_complete: 1,
          address: '2 St',
          game_mode: 'Regular',
          following_santa_uri: 'at://x/y/2',
          avatar_url: 'g.jpg',
          note_count: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const match = await db
        .insertInto('match')
        .values({
          santa: santa.id,
          giftee: giftee.id,
          has_present: 0,
          invalid_player: 0,
          match_status: 'shared',
          nudge_count: 0,
          nudge_present_update_count: 0,
          tracking_count: 0,
          tracking_missing_count: 0,
          super_santa_match: 0,
          posted_opening: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const nudgeType = await db
        .selectFrom('nudge_type')
        .selectAll()
        .where('name', '=', 'Hint')
        .executeTakeFirstOrThrow();

      const greeting = await db
        .insertInto('nudge_greeting')
        .values({ text: 'Hi' })
        .returningAll()
        .executeTakeFirstOrThrow();

      const signoff = await db
        .insertInto('nudge_signoff')
        .values({ text: 'Bye' })
        .returningAll()
        .executeTakeFirstOrThrow();

      await db
        .insertInto('nudge_type_greeting')
        .values({ nudge_type: nudgeType.id, greeting: greeting.id })
        .execute();

      await db
        .insertInto('nudge_type_signoff')
        .values({ nudge_type: nudgeType.id, signoff: signoff.id })
        .execute();

      await db
        .insertInto('nudge')
        .values({
          nudge_type: nudgeType.id,
          nudge_greeting: greeting.id,
          nudge_signoff: signoff.id,
          match: match.id,
          nudge_status: 'queued',
          created_at: '2025-12-01T00:00:00Z',
          created_by: 'did:plc:santa',
        })
        .execute();

      const postMock = vi.fn().mockRejectedValue(new Error('Network error'));
      const robotAgent = vi.fn().mockResolvedValue({ post: postMock });
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      vi.setSystemTime(new Date('2025-12-25T23:00:00Z'));
      const sender = new NudgeSender(db, robotAgent);
      await sender.sendANudge();

      const updatedNudge = await db
        .selectFrom('nudge')
        .selectAll()
        .executeTakeFirstOrThrow();
      expect(updatedNudge.nudge_status).toBe('error: Network error');
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(mockedNewrelic.default?.noticeError).toHaveBeenCalled();
    });

    it('handles prepare error gracefully', async () => {
      const db = createDb();
      await migrateToLatest(db);
      await db
        .updateTable('settings')
        .set({ nudge_rate: '1 hour', send_messages: 1 })
        .where('id', '=', 0)
        .execute();
      const robotAgent = vi.fn().mockResolvedValue({});
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      vi.setSystemTime(new Date('2025-12-25T23:00:00Z'));
      // Make it fail by dropping table to cause query error
      await db.schema.dropTable('nudge').execute();
      const sender = new NudgeSender(db, robotAgent);
      await sender.sendANudge();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Unable to prepare nudge',
        expect.any(Error)
      );
    });
  });
});
