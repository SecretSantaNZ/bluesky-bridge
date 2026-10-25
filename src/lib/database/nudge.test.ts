import { describe, expect, it } from 'vitest';
import { createDb, migrateToLatest } from './index.js';
import { queryFullNudge, loadNudgeOptions } from './nudge.js';

describe('nudge queries', () => {
  it('queryFullNudge returns nudges with related data', async () => {
    const db = createDb();
    await migrateToLatest(db);

    const santa = await db
      .insertInto('player')
      .values({
        did: 'did:plc:ns1',
        handle: 'ns1.bsky.social',
        player_type: 'bluesky',
        max_giftees: 1,
        giftee_count: 0,
        profile_complete: 1,
        signup_complete: 1,
        address: '1 St',
        game_mode: 'Regular',
        following_santa_uri: 'at://x/y/1',
        avatar_url: 's.jpg',
        note_count: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const giftee = await db
      .insertInto('player')
      .values({
        did: 'did:plc:ng1',
        handle: 'ng1.bsky.social',
        player_type: 'bluesky',
        max_giftees: 1,
        giftee_count: 0,
        profile_complete: 1,
        signup_complete: 1,
        address: '2 St',
        game_mode: 'Regular',
        following_santa_uri: 'at://x/y/2',
        avatar_url: 'g.jpg',
        note_count: 2,
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
      .limit(1)
      .executeTakeFirstOrThrow();

    const greeting = await db
      .insertInto('nudge_greeting')
      .values({ text: 'Hi!' })
      .returningAll()
      .executeTakeFirstOrThrow();

    const signoff = await db
      .insertInto('nudge_signoff')
      .values({ text: 'Bye!' })
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
        created_by: 'did:plc:ns1',
      })
      .execute();

    const nudges = await queryFullNudge(db).execute();
    expect(nudges).toHaveLength(1);
    expect(nudges[0]!.santa_handle).toBe('ns1.bsky.social');
    expect(nudges[0]!.giftee_handle).toBe('ng1.bsky.social');
    expect(nudges[0]!.nudge_type).toBe(nudgeType.name);
    expect(nudges[0]!.nudge_status).toBe('queued');
  });

  it('loadNudgeOptions returns structured options grouped by nudge type', async () => {
    const db = createDb();
    await migrateToLatest(db);

    const nudgeType = await db
      .selectFrom('nudge_type')
      .selectAll()
      .limit(1)
      .executeTakeFirstOrThrow();

    const greeting = await db
      .insertInto('nudge_greeting')
      .values({ text: 'Hello there' })
      .returningAll()
      .executeTakeFirstOrThrow();

    const signoff = await db
      .insertInto('nudge_signoff')
      .values({ text: 'Take care' })
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

    const options = await loadNudgeOptions(db);

    expect(options.nudgeTypes.length).toBeGreaterThan(0);
    expect(Object.keys(options.nudgeGreetings).length).toBeGreaterThan(0);
    expect(Object.keys(options.nudgeSignoffs).length).toBeGreaterThan(0);
    const typeId = options.nudgeTypes[0]!.id;
    expect(Array.isArray(options.nudgeGreetings[typeId])).toBe(true);
    expect(Array.isArray(options.nudgeSignoffs[typeId])).toBe(true);
  });
});
