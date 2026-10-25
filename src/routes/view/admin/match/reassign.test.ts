import { describe, expect, it } from 'vitest';
import {
  createDb,
  migrateToLatest,
  type Database,
} from '../../../../lib/database/index.js';
import type { DatabaseSchema } from '../../../../lib/database/schema.js';
import type { InsertObject } from 'kysely';
import { reassignMatch, type ReassignOutcome } from './reassign.js';
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
      ...overrides,
    } as InsertObject<DatabaseSchema, 'match'>)
    .returningAll()
    .executeTakeFirstOrThrow();
}

describe('reassignMatch', () => {
  it('fails when the requested santa cannot be found', async () => {
    const db = await setupDb();
    const santa = await insertPlayer(db, { handle: 'santa.bsky.social' });
    const giftee = await insertPlayer(db, { handle: 'giftee.bsky.social' });
    const match = await insertMatch(db, santa.id, giftee.id);

    const outcome = await reassignMatch(db, {
      match_id: match.id,
      santa_handle: 'nobody.bsky.social',
      super_santa_match: undefined,
      force: undefined,
    });
    expect(outcome).toEqual({
      ok: false,
      status: 409,
      error: 'santa-not-found',
    });
    const stillThere = await db
      .selectFrom('match')
      .selectAll()
      .where('id', '=', match.id)
      .execute();
    expect(stillThere).toHaveLength(1);
  });

  it('fails when the santa already has too many giftees, unless forced', async () => {
    const db = await setupDb();
    const santa = await insertPlayer(db, { handle: 'santa.bsky.social' });
    const giftee = await insertPlayer(db, { handle: 'giftee.bsky.social' });
    await insertPlayer(db, { handle: 'full.bsky.social', max_giftees: 0 });
    const match = await insertMatch(db, santa.id, giftee.id);

    const outcome = await reassignMatch(db, {
      match_id: match.id,
      santa_handle: 'full.bsky.social',
      super_santa_match: undefined,
      force: undefined,
    });
    expect(outcome).toEqual({
      ok: false,
      status: 409,
      error: 'too-many-giftees',
    } satisfies ReassignOutcome);

    const forced = await reassignMatch(db, {
      match_id: match.id,
      santa_handle: 'full.bsky.social',
      super_santa_match: undefined,
      force: 'true',
    });
    expect(forced.ok).toBe(true);
  });

  it('deactivates the old match and creates a draft replacement', async () => {
    const db = await setupDb();
    const oldSanta = await insertPlayer(db, { handle: 'old.bsky.social' });
    const newSanta = await insertPlayer(db, { handle: 'new.bsky.social' });
    const giftee = await insertPlayer(db, { handle: 'giftee.bsky.social' });
    const match = await insertMatch(db, oldSanta.id, giftee.id);

    const outcome = await reassignMatch(db, {
      match_id: match.id,
      santa_handle: 'new.bsky.social',
      super_santa_match: undefined,
      force: undefined,
    });
    expect(outcome.ok).toBe(true);

    const matches = await db
      .selectFrom('match')
      .selectAll()
      .where('id', 'in', [match.id, match.id + 1])
      .execute()
      .then((rows) => new Map(rows.map((row) => [row.id, row])));
    expect(matches.get(match.id)?.deactivated).not.toBeNull();
    const replacement = matches.get(match.id + 1);
    expect(replacement).toMatchObject({
      santa: newSanta.id,
      giftee: giftee.id,
      match_status: 'draft',
      super_santa_match: 0,
    });
  });

  it('flags super santa matches instead of deactivating', async () => {
    const db = await setupDb();
    const oldSanta = await insertPlayer(db, { handle: 'old.bsky.social' });
    const newSanta = await insertPlayer(db, { handle: 'new.bsky.social' });
    const giftee = await insertPlayer(db, { handle: 'giftee.bsky.social' });
    const match = await insertMatch(db, oldSanta.id, giftee.id);

    const outcome = await reassignMatch(db, {
      match_id: match.id,
      santa_handle: 'new.bsky.social',
      super_santa_match: 'true',
      force: undefined,
    });
    expect(outcome.ok).toBe(true);

    const matches = await db
      .selectFrom('match')
      .selectAll()
      .where('id', 'in', [match.id, match.id + 1])
      .execute()
      .then((rows) => new Map(rows.map((row) => [row.id, row])));
    expect(matches.get(match.id)).toMatchObject({
      deactivated: null,
      followup_action: 'super-assigned',
    });
    expect(matches.get(match.id + 1)).toMatchObject({
      santa: newSanta.id,
      match_status: 'locked',
      super_santa_match: 1,
    });
  });
});
