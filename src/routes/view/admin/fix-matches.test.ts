import { describe, expect, it } from 'vitest';
import {
  createDb,
  migrateToLatest,
  type Database,
} from '../../../lib/database/index.js';
import type { DatabaseSchema } from '../../../lib/database/schema.js';
import type { InsertObject } from 'kysely';
import {
  buildBrokenMatchesQuery,
  buildMultipleGifteeMatchesQuery,
  buildTooManyGifteeMatchesQuery,
  buildTooManySantasMatchesQuery,
} from './fix-matches.js';

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
      match_status: 'shared',
      nudge_count: 0,
      nudge_present_update_count: 0,
      tracking_count: 0,
      tracking_missing_count: 0,
      super_santa_match: 0,
      ...overrides,
    } as InsertObject<DatabaseSchema, 'match'>)
    .returningAll()
    .executeTakeFirstOrThrow();
}

describe('fix-matches query builders', () => {
  it('buildBrokenMatchesQuery returns active matches involving an invalid player', async () => {
    const db = await setupDb();
    const santa = await insertPlayer(db, { handle: 'santa.bsky.social' });
    const giftee = await insertPlayer(db, { handle: 'giftee.bsky.social' });
    await insertMatch(db, santa.id, giftee.id); // ok match, not returned
    const broken = await insertMatch(db, santa.id, giftee.id, {
      invalid_player: 1,
    });
    await insertMatch(db, santa.id, giftee.id, {
      invalid_player: 1,
      deactivated: '2025-12-01',
    });

    const rows = await buildBrokenMatchesQuery(db).execute();
    expect(rows.map(({ match_id }) => match_id)).toEqual([broken.id]);
    expect(rows[0]).toMatchObject({ santa_did: 'did:plc:santa.bsky.social' });
  });

  it('buildTooManyGifteeMatchesQuery flags santas whose status is too_many', async () => {
    const db = await setupDb();
    const santa = await insertPlayer(db, { handle: 'santa.bsky.social' });
    const giftee = await insertPlayer(db, { handle: 'giftee.bsky.social' });
    // One extra giftee beyond max -> giftee_count_status becomes too_many
    await insertMatch(db, santa.id, giftee.id);
    await insertMatch(db, santa.id, giftee.id);

    const rows = await buildTooManyGifteeMatchesQuery(db).execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      santa_id: santa.id,
      match_status: 'shared',
    });
  });

  it('buildTooManySantasMatchesQuery flags giftees matched to more than one santa', async () => {
    const db = await setupDb();
    const santaA = await insertPlayer(db, { handle: 'santa-a.bsky.social' });
    const santaB = await insertPlayer(db, { handle: 'santa-b.bsky.social' });
    const giftee = await insertPlayer(db, { handle: 'giftee.bsky.social' });
    await insertMatch(db, santaA.id, giftee.id);
    await insertMatch(db, santaB.id, giftee.id);

    const rows = await buildTooManySantasMatchesQuery(db).execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ giftee_id: giftee.id });
  });

  it('buildMultipleGifteeMatchesQuery flags santas with multiple giftees', async () => {
    const db = await setupDb();
    const santa = await insertPlayer(db, { handle: 'santa.bsky.social' });
    const gifteeA = await insertPlayer(db, { handle: 'giftee-a.bsky.social' });
    const gifteeB = await insertPlayer(db, { handle: 'giftee-b.bsky.social' });
    await insertMatch(db, santa.id, gifteeA.id);
    await insertMatch(db, santa.id, gifteeB.id);

    const rows = await buildMultipleGifteeMatchesQuery(db).execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ santa_id: santa.id });
  });

  it('returns nothing when every match is valid and assignments are sane', async () => {
    const db = await setupDb();
    const santaA = await insertPlayer(db, { handle: 'santa-a.bsky.social' });
    const santaB = await insertPlayer(db, { handle: 'santa-b.bsky.social' });
    const gifteeA = await insertPlayer(db, { handle: 'giftee-a.bsky.social' });
    const gifteeB = await insertPlayer(db, { handle: 'giftee-b.bsky.social' });
    // One giftee per santa, one santa per giftee, nobody over max_giftees
    // and no invalid players.
    await insertMatch(db, santaA.id, gifteeA.id);
    await insertMatch(db, santaB.id, gifteeB.id);

    expect(await buildBrokenMatchesQuery(db).execute()).toEqual([]);
    expect(await buildMultipleGifteeMatchesQuery(db).execute()).toEqual([]);
    expect(await buildTooManyGifteeMatchesQuery(db).execute()).toEqual([]);
    expect(await buildTooManySantasMatchesQuery(db).execute()).toEqual([]);
  });
});
