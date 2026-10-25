import { describe, expect, it } from 'vitest';
import {
  createDb,
  migrateToLatest,
  type Database,
} from '../../lib/database/index.js';
import type { DatabaseSchema } from '../../lib/database/schema.js';
import type { InsertObject } from 'kysely';
import { createPlayerNudge, type NudgeInput } from './nudge.js';
import { BadRequestError } from 'http-errors-enhanced';

const DID = 'did:plc:santa';

async function setupDb(): Promise<Database> {
  const db = createDb();
  await migrateToLatest(db);
  return db;
}

type Values = {
  santa: { id: number; did: string };
  giftee: { id: number; did: string };
  match: { id: number };
  type: { id: number };
  greeting: { id: number };
  signoff: { id: number };
};

async function seed(db: Database): Promise<Values> {
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

  const type = await db
    .insertInto('nudge_type')
    .values({ name: 'Custom Type', order_index: 99 })
    .returningAll()
    .executeTakeFirstOrThrow();
  const greeting = await db
    .insertInto('nudge_greeting')
    .values({ text: 'Locker greeting' })
    .returningAll()
    .executeTakeFirstOrThrow();
  const signoff = await db
    .insertInto('nudge_signoff')
    .values({ text: 'Locker signoff' })
    .returningAll()
    .executeTakeFirstOrThrow();
  const otherGreeting = await db
    .insertInto('nudge_greeting')
    .values({ text: 'Other type greeting' })
    .returningAll()
    .executeTakeFirstOrThrow();
  const otherSignoff = await db
    .insertInto('nudge_signoff')
    .values({ text: 'Other type signoff' })
    .returningAll()
    .executeTakeFirstOrThrow();
  const otherType = await db
    .insertInto('nudge_type')
    .values({ name: 'Other Type', order_index: 100 })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db
    .insertInto('nudge_type_greeting')
    .values([
      { nudge_type: type.id, greeting: greeting.id },
      { nudge_type: otherType.id, greeting: otherGreeting.id },
    ])
    .execute();
  await db
    .insertInto('nudge_type_signoff')
    .values([
      { nudge_type: type.id, signoff: signoff.id },
      { nudge_type: otherType.id, signoff: otherSignoff.id },
    ])
    .execute();

  return { santa, giftee, match, type, greeting, signoff };
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

const input = (over: Partial<NudgeInput> = {}): NudgeInput => ({
  match_id: 1,
  nudge_type: 1,
  nudge_greeting: 1,
  nudge_signoff: 1,
  ...over,
});

describe('createPlayerNudge', () => {
  it('records a queued nudge for a valid combination', async () => {
    const db = await setupDb();
    const seeded = await seed(db);
    await createPlayerNudge(
      db,
      seeded.santa,
      DID,
      input({
        match_id: seeded.match.id,
        nudge_type: seeded.type.id,
        nudge_greeting: seeded.greeting.id,
        nudge_signoff: seeded.signoff.id,
      })
    );
    const nudge = await db
      .selectFrom('nudge')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(nudge).toMatchObject({
      match: seeded.match.id,
      nudge_type: seeded.type.id,
      nudge_greeting: seeded.greeting.id,
      nudge_signoff: seeded.signoff.id,
      nudge_status: 'queued',
      created_by: DID,
    });
    const match = await db
      .selectFrom('match')
      .selectAll()
      .where('id', '=', seeded.match.id)
      .executeTakeFirstOrThrow();
    expect(match.nudge_count).toBe(1);
  });

  it('rejects a greeting that belongs to a different nudge type', async () => {
    const db = await setupDb();
    const seeded = await seed(db);
    await expect(
      createPlayerNudge(
        db,
        seeded.santa,
        DID,
        input({
          match_id: seeded.match.id,
          nudge_type: seeded.type.id,
          nudge_greeting: seeded.greeting.id + 2,
          nudge_signoff: seeded.signoff.id,
        })
      )
    ).rejects.toThrow();
  });

  it('rejects a signoff that belongs to a different nudge type', async () => {
    const db = await setupDb();
    const seeded = await seed(db);
    await expect(
      createPlayerNudge(
        db,
        seeded.santa,
        DID,
        input({
          match_id: seeded.match.id,
          nudge_type: seeded.type.id,
          nudge_greeting: seeded.greeting.id,
          nudge_signoff: seeded.signoff.id + 2,
        })
      )
    ).rejects.toThrow();
  });

  it('rejects the sixth nudge for a match', async () => {
    const db = await setupDb();
    const seeded = await seed(db);
    for (let i = 0; i < 5; i++) {
      await db
        .insertInto('nudge')
        .values({
          nudge_type: seeded.type.id,
          nudge_greeting: seeded.greeting.id,
          nudge_signoff: seeded.signoff.id,
          match: seeded.match.id,
          nudge_status: 'sent',
          created_at: '2025-12-01T00:00:00Z',
          created_by: DID,
        } as InsertObject<DatabaseSchema, 'nudge'>)
        .execute();
    }
    await expect(
      createPlayerNudge(
        db,
        seeded.santa,
        DID,
        input({
          match_id: seeded.match.id,
          nudge_type: seeded.type.id,
          nudge_greeting: seeded.greeting.id,
          nudge_signoff: seeded.signoff.id,
        })
      )
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects a nudge targeting a match owned by a different santa', async () => {
    const db = await setupDb();
    const seeded = await seed(db);
    const otherSanta = await db
      .insertInto('player')
      .values(playerValues('other-santa.bsky.social'))
      .returningAll()
      .executeTakeFirstOrThrow();
    const otherMatch = await db
      .insertInto('match')
      .values(matchValues(otherSanta.id, seeded.giftee.id))
      .returningAll()
      .executeTakeFirstOrThrow();

    await expect(
      createPlayerNudge(
        db,
        seeded.santa,
        DID,
        input({
          match_id: otherMatch.id,
          nudge_type: seeded.type.id,
          nudge_greeting: seeded.greeting.id,
          nudge_signoff: seeded.signoff.id,
        })
      )
    ).rejects.toThrow();
    const nudges = await db.selectFrom('nudge').selectAll().execute();
    expect(nudges).toHaveLength(0);
    const match = await db
      .selectFrom('match')
      .selectAll()
      .where('id', '=', otherMatch.id)
      .executeTakeFirstOrThrow();
    expect(match.nudge_count).toBe(0);
  });
});
