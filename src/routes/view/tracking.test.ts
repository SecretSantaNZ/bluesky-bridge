import { describe, expect, it } from 'vitest';
import {
  createDb,
  migrateToLatest,
  type Database,
} from '../../lib/database/index.js';
import type { DatabaseSchema } from '../../lib/database/schema.js';
import type { InsertObject } from 'kysely';
import { addPlayerTracking, type TrackingInput } from './tracking.js';
import { BadRequestError } from 'http-errors-enhanced';

const DID = 'did:plc:santa';

const input = (over = {}): TrackingInput => ({
  shipped_date: '2025-12-01',
  carrier: 1,
  tracking_number: 'NZ123456789',
  giftwrap_status: 0,
  ...over,
});

async function setupDb(): Promise<Database> {
  const db = createDb();
  await migrateToLatest(db);
  return db;
}

async function addTracking(db: Database, times = 1) {
  const matchId = await insertPlayerAndMatch(db);
  for (let i = 0; i < times; i++) {
    await addPlayerTracking(
      db,
      { id: matchId.playerId },
      DID,
      matchId.matchId,
      input()
    );
  }
  return matchId;
}

async function insertPlayerAndMatch(db: Database) {
  const santa = await db
    .insertInto('player')
    .values(playerValues('santa.bsky.social'))
    .returningAll()
    .executeTakeFirstOrThrow();
  const giftee = await db
    .insertInto('player')
    .values(playerValues('giftee.bsky.social'))
    .returningAll()
    .executeTakeFirstOrThrow();
  const match = await db
    .insertInto('match')
    .values(matchValues(santa.id, giftee.id))
    .returningAll()
    .executeTakeFirstOrThrow();
  return { playerId: santa.id, matchId: match.id };
}

const playerValues = (handle: string) =>
  ({
    did: `did:plc:${handle}`,
    handle,
    player_type: 'bluesky',
    profile_complete: 1,
    signup_complete: 1,
    max_giftees: 1,
    giftee_count: 0,
    game_mode: 'Regular',
  }) as InsertObject<DatabaseSchema, 'player'>;

const matchValues = (santa: number, giftee: number) =>
  ({
    santa,
    giftee,
    has_present: 0,
    invalid_player: 0,
    match_status: 'locked',
    nudge_count: 0,
    nudge_present_update_count: 0,
    tracking_count: 0,
    tracking_missing_count: 0,
    super_santa_match: 0,
  }) as InsertObject<DatabaseSchema, 'match'>;

describe('addPlayerTracking', () => {
  it('inserts a queued tracking row and redirects to the badge on the first tracking', async () => {
    const db = await setupDb();
    const { matchId } = await insertPlayerAndMatch(db);
    const carrier = await db
      .selectFrom('carrier')
      .selectAll()
      .limit(1)
      .executeTakeFirstOrThrow();

    const result = await addPlayerTracking(
      db,
      {
        id: (
          await db
            .selectFrom('match')
            .select('santa')
            .where('id', '=', matchId)
            .executeTakeFirstOrThrow()
        ).santa,
      },
      DID,
      matchId,
      input({ carrier: carrier.id })
    );
    expect(result).toEqual({ badge: 1 });

    const tracking = await db
      .selectFrom('tracking')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(tracking).toMatchObject({
      match: matchId,
      tracking_status: 'queued',
      tracking_number: 'NZ123456789',
    });
  });

  it('does not send the santa to the badge page on subsequent trackings', async () => {
    const db = await setupDb();
    const { playerId, matchId } = await addTracking(db);
    const carrier = await db
      .selectFrom('carrier')
      .selectAll()
      .limit(1)
      .executeTakeFirstOrThrow();
    const result = await addPlayerTracking(
      db,
      { id: playerId },
      DID,
      matchId,
      input({ carrier: carrier.id })
    );
    expect(result).toEqual({ path: '/' });
  });

  it('redirects home when there is no sent-present badge configured', async () => {
    const db = await setupDb();
    await db
      .updateTable('settings')
      .set({ sent_present_badge_id: null })
      .where('id', '=', 0)
      .execute();
    const { playerId, matchId } = await addTracking(db);
    const result = await addPlayerTracking(
      db,
      { id: playerId },
      DID,
      matchId,
      input()
    );
    expect(result).toEqual({ path: '/' });
  });

  it('rejects the sixth tracking for a match', async () => {
    const db = await setupDb();
    const { playerId, matchId } = await addTracking(db, 5);
    await expect(
      addPlayerTracking(db, { id: playerId }, DID, matchId, input())
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects unknown carriers', async () => {
    const db = await setupDb();
    const { playerId, matchId } = await insertPlayerAndMatch(db);
    await expect(
      addPlayerTracking(
        db,
        { id: playerId },
        DID,
        matchId,
        input({ carrier: 999 })
      )
    ).rejects.toThrow();
  });

  it('rejects tracking a match owned by a different santa', async () => {
    const db = await setupDb();
    const { playerId, matchId } = await insertPlayerAndMatch(db);
    const otherSanta = await db
      .insertInto('player')
      .values(playerValues('other-santa.bsky.social'))
      .returningAll()
      .executeTakeFirstOrThrow();
    const otherMatch = await db
      .insertInto('match')
      .values(
        matchValues(
          otherSanta.id,
          (
            await db
              .selectFrom('match')
              .select('giftee')
              .where('id', '=', matchId)
              .executeTakeFirstOrThrow()
          ).giftee
        )
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    const carrier = await db
      .selectFrom('carrier')
      .selectAll()
      .limit(1)
      .executeTakeFirstOrThrow();

    await expect(
      addPlayerTracking(
        db,
        { id: playerId },
        DID,
        otherMatch.id,
        input({ carrier: carrier.id })
      )
    ).rejects.toThrow();
    expect(await db.selectFrom('tracking').selectAll().execute()).toHaveLength(
      0
    );
  });
});
