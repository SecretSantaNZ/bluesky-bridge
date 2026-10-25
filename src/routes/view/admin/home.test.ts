import { describe, expect, it } from 'vitest';
import {
  createDb,
  migrateToLatest,
  type Database,
} from '../../../lib/database/index.js';
import type { DatabaseSchema } from '../../../lib/database/schema.js';
import type { InsertObject } from 'kysely';
import { adminHomeCounts } from './home.js';
import { draftMatchesData } from './draft-matches.js';

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
      deactivated: 0,
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
      match_status: 'draft',
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

describe('adminHomeCounts', () => {
  it('summarizes player, match, nudge and tracking state', async () => {
    const db = await setupDb();
    const santa = await insertPlayer(db, { handle: 'santa.bsky.social' });
    const giftee = await insertPlayer(db, { handle: 'giftee.bsky.social' });
    await insertPlayer(db, {
      handle: 'unsigned.bsky.social',
      signup_complete: 0,
    }); // registered but signup incomplete
    await insertMatch(db, santa.id, giftee.id); // unsent (draft)
    await insertMatch(db, santa.id, giftee.id, { match_status: 'shared' });
    await insertMatch(db, santa.id, giftee.id, {
      invalid_player: 1,
    }); // broken match
    await insertMatch(db, santa.id, giftee.id, {
      match_status: 'shared',
    }); // santa now has 3 giftee_count > max 1

    const counts = await adminHomeCounts(db);

    expect(counts.signupCompleteCount).toBe(2); // santa + giftee
    expect(counts.registeredPlayersCount).toBe(3);
    // 1 broken match + all 4 matches of the over-full santa
    expect(counts.criticalMatchIssues).toBe(5);
    // 2 matches with multiple santas for the giftee + 2 with multiple giftees for the santa
    expect(counts.warnMatchIssues).toBe(8);
    expect(counts.unsentMatches).toBe(2);
    expect(counts.sharedMatches).toBe(2);
    expect(counts.playersNeedingMatchesCount).toBe(1); // santa still accepts giftees
    expect(counts.presentsToFollowUpCount).toBe(0);
  });
});

describe('draftMatchesData', () => {
  it('counts players needing a santa and aggregates match issue sums', async () => {
    const db = await setupDb();
    const santa = await insertPlayer(db, { handle: 'santa.bsky.social' });
    const giftee = await insertPlayer(db, { handle: 'giftee.bsky.social' });
    await insertMatch(db, santa.id, giftee.id);
    await insertMatch(db, santa.id, giftee.id, { invalid_player: 1 });

    const data = await draftMatchesData(db);
    console.log(
      'DBG2',
      JSON.stringify(data.countNeedsSantaAssigned),
      'crit',
      JSON.stringify(data.criticalMatchIssues)
    );

    expect(data.draftMatches).toHaveLength(2);
    expect(data.countNeedsSantaAssigned).toBe(1); // santa still accepts giftees
    expect(data.criticalMatchIssues).toBe(3); // 1 broken + 2 matches of the too-many santa
  });
});
