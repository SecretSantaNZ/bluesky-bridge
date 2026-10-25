import { describe, expect, it } from 'vitest';
import {
  createDb,
  migrateToLatest,
  type Database,
} from '../../../../lib/database/index.js';
import type { DatabaseSchema } from '../../../../lib/database/schema.js';
import type { InsertObject } from 'kysely';
import {
  buildMatchInserts,
  buildMatches,
  forbiddenPairsFromDeactivated,
  pairGifteeAndSanta,
  queryPlayersNeedingSanta,
  querySantas,
  type MatchNode,
} from './autoMatch.js';

async function setupDb(): Promise<Database> {
  const db = createDb();
  await migrateToLatest(db);
  return db;
}

async function insertPlayer(
  db: Database,
  overrides: Partial<InsertObject<DatabaseSchema, 'player'>> = {}
) {
  const did = overrides.did ?? `did:plc:${overrides.handle}`;
  return await db
    .insertInto('player')
    .values({
      did,
      handle: 'player.bsky.social',
      player_type: 'bluesky',
      profile_complete: 1,
      signup_complete: 1,
      max_giftees: 1,
      giftee_count: 0,
      game_mode: 'Regular',
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

describe('queryPlayersNeedingSanta', () => {
  it('only returns signed up players without a santa, sorted randomly', async () => {
    const db = await setupDb();
    const aPlayer = await insertPlayer(db, { handle: 'a.bsky.social' });
    await insertPlayer(db, { handle: 'b.bsky.social', signup_complete: 0 });
    await insertPlayer(db, { handle: 'c.bsky.social', giftee_for_count: 1 });
    await insertPlayer(db, {
      handle: 'd.bsky.social',
      game_mode: 'Santa Only',
    });

    const result = await queryPlayersNeedingSanta(db, {});
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ id: aPlayer.id }));
  });

  it('max_post_count_threshold caps by total post count when the AND branch is disabled', async () => {
    const db = await setupDb();
    await insertPlayer(db, { handle: 'few.bsky.social', post_count: 2 });
    await insertPlayer(db, { handle: 'many.bsky.social', post_count: 10 });

    // max_post_count_since_signup = -1 (any negative) makes the AND branch
    // unmatchable (0 falls back to unbounded), so only the threshold rule
    // can select players.
    const result = await queryPlayersNeedingSanta(db, {
      max_post_count_threshold: 5,
      max_post_count_since_signup: -1,
    });
    const few = await db
      .selectFrom('player')
      .select('id')
      .where('handle', '=', 'few.bsky.social')
      .executeTakeFirstOrThrow();
    expect(result.map(({ id }) => id)).toEqual([few.id]);
  });

  it('with no options the AND branch defaults are unbounded so every player matches', async () => {
    const db = await setupDb();
    await insertPlayer(db, {
      handle: 'ok.bsky.social',
      post_count: 4,
      post_count_since_signup: 2,
    });
    await insertPlayer(db, {
      handle: 'no-recent.bsky.social',
      post_count: 4,
      post_count_since_signup: 100,
    });

    const result = await queryPlayersNeedingSanta(db, {});
    expect(result).toHaveLength(2);
  });
});

describe('querySantas', () => {
  it('returns players who can have more giftees, prioritizing lower giftee_count', async () => {
    const db = await setupDb();
    await insertPlayer(db, {
      handle: 'a.bsky.social',
      max_giftees: 2,
      giftee_count: 1,
    });
    await insertPlayer(db, {
      handle: 'b.bsky.social',
      max_giftees: 1,
      giftee_count: 0,
    });
    await insertPlayer(db, {
      handle: 'full.bsky.social',
      max_giftees: 1,
      giftee_count: 1,
    });
    await insertPlayer(db, {
      handle: 'over.bsky.social',
      max_giftees: 1,
      giftee_count: 2,
    });

    const result = await querySantas(db, {});
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, max_giftees: 2 }),
        expect.objectContaining({ id: 2, max_giftees: 1 }),
      ])
    );
    expect(result).toHaveLength(2);
  });

  it('applies the AND rule between recent and total post counts', async () => {
    const db = await setupDb();
    // Fails only the recent-post rule
    await insertPlayer(db, {
      handle: 'old.bsky.social',
      post_count: 1,
      post_count_since_signup: 10,
    });
    // Fails only the total-post rule (threshold rule can never fire here)
    await insertPlayer(db, {
      handle: 'big.bsky.social',
      post_count: 100,
      post_count_since_signup: 1,
    });
    // Passes both
    await insertPlayer(db, {
      handle: 'ok.bsky.social',
      post_count: 4,
      post_count_since_signup: 2,
    });

    const result = await querySantas(db, {
      max_post_count_since_signup: 5,
      max_post_count_and: 10,
    });
    const handled = await db
      .selectFrom('player')
      .select('id')
      .where('handle', '=', 'ok.bsky.social')
      .executeTakeFirstOrThrow();
    expect(result.map(({ id }) => id)).toEqual([handled.id]);
  });

  it('max_post_count_threshold caps by total post count when the AND branch is disabled', async () => {
    const db = await setupDb();
    await insertPlayer(db, { handle: 'few.bsky.social', post_count: 2 });
    await insertPlayer(db, { handle: 'many.bsky.social', post_count: 10 });

    // max_post_count_since_signup = -1 (any negative) makes the AND branch
    // unmatchable (0 falls back to unbounded), so only the threshold rule
    // can select players.
    const result = await querySantas(db, {
      max_post_count_threshold: 5,
      max_post_count_since_signup: -1,
    });
    const few = await db
      .selectFrom('player')
      .select('id')
      .where('handle', '=', 'few.bsky.social')
      .executeTakeFirstOrThrow();
    expect(result.map(({ id }) => id)).toEqual([few.id]);
  });

  it('with no options the AND branch defaults are unbounded so every player matches', async () => {
    const db = await setupDb();
    await insertPlayer(db, {
      handle: 'ok.bsky.social',
      post_count: 4,
      post_count_since_signup: 2,
    });
    await insertPlayer(db, {
      handle: 'no-recent.bsky.social',
      post_count: 4,
      post_count_since_signup: 100,
    });

    const result = await querySantas(db, {});
    expect(result).toHaveLength(2);
  });
});

describe('pairGifteeAndSanta', () => {
  it('pairs each giftee with a santa, re-queuing santas below max_giftees', () => {
    const giftees = [{ id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }];
    const santas = [
      { id: 1, giftee_count: 0, max_giftees: 2 },
      { id: 2, giftee_count: 0, max_giftees: 1 },
    ];
    const nodes = pairGifteeAndSanta(giftees, santas);
    expect(nodes).toEqual([
      { giftee: 11, santa: 1 },
      { giftee: 12, santa: 2 },
      { giftee: 13, santa: 1 },
    ]);
  });

  it('stops pairing when the santa queue is empty', () => {
    const nodes = pairGifteeAndSanta(
      [{ id: 1 }, { id: 2 }],
      [{ id: 9, giftee_count: 0, max_giftees: 1 }]
    );
    expect(nodes).toEqual([{ giftee: 1, santa: 9 }]);
  });
});

describe('buildMatches', () => {
  const giftees = [{ id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }, { id: 15 }];
  const santas = [
    { id: 1, giftee_count: 0, max_giftees: 1 },
    { id: 2, giftee_count: 0, max_giftees: 1 },
    { id: 3, giftee_count: 0, max_giftees: 1 },
    { id: 4, giftee_count: 0, max_giftees: 1 },
    { id: 5, giftee_count: 0, max_giftees: 1 },
  ];

  it('returns a permutation of the paired nodes', () => {
    const shuffled = buildMatches(giftees, santas, {}, () => 0);
    expect(shuffled.map((n) => n.giftee).sort()).toEqual(
      giftees.map((g) => g.id).sort()
    );
    expect(shuffled.map((n) => n.santa).sort()).toEqual(
      santas.map((s) => s.id).sort()
    );
  });

  it('throws when forbidden pairs block every attempted swap', () => {
    const forbidden = { 1: new Set([12]) };
    expect(() => buildMatches(giftees, santas, forbidden, () => 0)).toThrow(
      'cannot find valid match after 10 attempts'
    );
  });
});

describe('forbiddenPairsFromDeactivated', () => {
  it('groups deactivated gifs by santa', () => {
    const pairs = forbiddenPairsFromDeactivated([
      { santa: 1, giftee: 10 },
      { santa: 1, giftee: 20 },
      { santa: 2, giftee: 30 },
    ]);
    expect(pairs).toEqual({
      1: new Set([10, 20]),
      2: new Set([30]),
    });
  });
});

describe('buildMatchInserts', () => {
  it('builds draft matches from consecutive nodes wrapping around', () => {
    const nodes: MatchNode[] = [
      { santa: 1, giftee: 2 },
      { santa: 3, giftee: 4 },
    ];
    const matches = buildMatchInserts(nodes);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ santa: 1, giftee: 4 });
    expect(matches[1]).toMatchObject({ santa: 3, giftee: 2 });
    for (const match of matches) {
      expect(match).toMatchObject({
        match_status: 'draft',
        has_present: 0,
        invalid_player: 0,
        nudge_count: 0,
        tracking_count: 0,
      });
    }
  });
});
