import { describe, expect, it } from 'vitest';
import {
  createDb,
  migrateToLatest,
  type Database,
} from '../../../lib/database/index.js';
import type { DatabaseSchema } from '../../../lib/database/schema.js';
import type { InsertObject } from 'kysely';
import { buildHasntPostedQuery } from './hasnt-posted.js';

async function setupDb(): Promise<Database> {
  const db = createDb();
  await migrateToLatest(db);
  return db;
}

async function insertPlayer(
  db: Database,
  overrides: Partial<InsertObject<DatabaseSchema, 'player'>> = {}
) {
  const handle = overrides.handle ?? 'player.bsky.social';
  return await db
    .insertInto('player')
    .values({
      did: `did:plc:${handle}`,
      player_type: 'bluesky',
      profile_complete: 1,
      signup_complete: 1,
      max_giftees: 1,
      giftee_count: 0,
      game_mode: 'Regular',
      ...overrides,
      handle,
    } as InsertObject<DatabaseSchema, 'player'>)
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function insertMatch(
  db: Database,
  santaId: number,
  gifteeId: number,
  overrides: Partial<InsertObject<DatabaseSchema, 'match'>> = {}
) {
  return await db
    .insertInto('match')
    .values({
      santa: santaId,
      giftee: gifteeId,
      has_present: 0,
      invalid_player: 0,
      match_status: 'locked',
      nudge_count: 0,
      nudge_present_update_count: 0,
      tracking_count: 0,
      tracking_missing_count: 0,
      super_santa_match: 0,
      posted_opening: 0,
      ...overrides,
    } as InsertObject<DatabaseSchema, 'match'>)
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function insertPost(
  db: Database,
  overrides: Partial<InsertObject<DatabaseSchema, 'post'>> & { uri: string }
) {
  await db
    .insertInto('post')
    .values({
      author: 'did:plc:giftee.bsky.social',
      time_us: 1000,
      hasHashtag: 0,
      byPlayer: 1,
      distanceFromHashtag: 99,
      distanceFromPlayerWithHashtag: 99,
      rootByPlayerWithHashtag: 0,
      indexedAt: '2025-12-01T00:00:00.000Z',
      ...overrides,
    })
    .execute();
}

describe('buildHasntPostedQuery', () => {
  it('returns locked matches that have not posted an opening, with latest post data', async () => {
    const db = await setupDb();
    const santa = await insertPlayer(db, { handle: 'santa.bsky.social' });
    const giftee = await insertPlayer(db, { handle: 'giftee.bsky.social' });
    const pending = await insertMatch(db, santa.id, giftee.id);
    await insertMatch(db, santa.id, giftee.id, {
      posted_opening: 1,
    }); // already posted, not returned

    await insertPost(db, {
      uri: 'at://post/plain',
      author: 'did:plc:giftee.bsky.social',
      indexedAt: '2025-12-03T00:00:00.000Z',
    });
    await insertPost(db, {
      uri: 'at://post/hashtagged',
      author: 'did:plc:giftee.bsky.social',
      hasHashtag: 1,
      indexedAt: '2025-12-02T00:00:00.000Z',
    });

    const rows = await buildHasntPostedQuery(db).execute();
    expect(rows.map(({ match_id }) => match_id)).toEqual([pending.id]);
    expect(rows[0]).toMatchObject({
      lastPosted: '2025-12-03T00:00:00.000Z',
      lastHashtagged: '2025-12-02T00:00:00.000Z',
    });
  });

  it('leaves post columns null when the giftee has not posted at all', async () => {
    const db = await setupDb();
    const santa = await insertPlayer(db, { handle: 'santa.bsky.social' });
    const giftee = await insertPlayer(db, { handle: 'giftee.bsky.social' });
    await insertMatch(db, santa.id, giftee.id);

    const rows = await buildHasntPostedQuery(db).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lastPosted: null, lastHashtagged: null });
  });

  it('does not return matches whose giftee has posted', async () => {
    const db = await setupDb();
    const santa = await insertPlayer(db, { handle: 'santa.bsky.social' });
    const postedGiftee = await insertPlayer(db, {
      handle: 'posted-giftee.bsky.social',
    });
    const pendingGiftee = await insertPlayer(db, {
      handle: 'pending-giftee.bsky.social',
    });
    const posted = await insertMatch(db, santa.id, postedGiftee.id, {
      posted_opening: 1,
    });
    const pending = await insertMatch(db, santa.id, pendingGiftee.id);

    await insertPost(db, {
      uri: 'at://post/by-posted-giftee',
      author: 'did:plc:posted-giftee.bsky.social',
      indexedAt: '2025-12-04T00:00:00.000Z',
    });

    const rows = await buildHasntPostedQuery(db).execute();
    const ids = rows.map(({ match_id }) => match_id);
    expect(ids).toEqual([pending.id]);
    expect(ids).not.toContain(posted.id);
  });
});
