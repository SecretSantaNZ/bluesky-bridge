import { describe, expect, it } from 'vitest';
import { createDb, migrateToLatest } from './index.js';
import { queryTracking, queryTrackingWithGifteeAndSanta } from './tracking.js';

describe('tracking queries', () => {
  it('queryTracking returns tracking with carrier info for active tracking', async () => {
    const db = createDb();
    await migrateToLatest(db);

    let carrier = await db.selectFrom('carrier').selectAll().executeTakeFirst();
    if (carrier == null) {
      carrier = await db
        .insertInto('carrier')
        .values({ text: 'NZ Post' })
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    const santa = await db
      .insertInto('player')
      .values({
        did: 'did:plc:s1',
        handle: 's1.bsky.social',
        player_type: 'bluesky',
        max_giftees: 1,
        giftee_count: 0,
        profile_complete: 1,
        signup_complete: 1,
        address: '1 St',
        game_mode: 'Regular',
        following_santa_uri: 'at://did:plc:x/app.bsky.graph.follow/1',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const giftee = await db
      .insertInto('player')
      .values({
        did: 'did:plc:g1',
        handle: 'g1.bsky.social',
        player_type: 'bluesky',
        max_giftees: 1,
        giftee_count: 0,
        profile_complete: 1,
        signup_complete: 1,
        address: '2 St',
        game_mode: 'Regular',
        following_santa_uri: 'at://did:plc:x/app.bsky.graph.follow/2',
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

    const tracking = await db
      .insertInto('tracking')
      .values({
        carrier: carrier.id,
        shipped_date: '2025-12-01',
        tracking_number: 'ABC123',
        giftwrap_status: 0,
        match: match.id,
        tracking_status: 'queued',
        created_at: '2025-12-01T00:00:00Z',
        created_by: 'did:plc:s1',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const results = await queryTracking(db).execute();
    expect(results).toHaveLength(1);
    expect(results[0]!.tracking_id).toBe(tracking.id);
    expect(results[0]!.carrier).toBe('NZ Post');
    expect(results[0]!.tracking_number).toBe('ABC123');
  });

  it('queryTracking filters out deactivated tracking', async () => {
    const db = createDb();
    await migrateToLatest(db);

    const existing = await db.selectFrom('carrier').selectAll().execute();
    const carrier =
      existing[0] ??
      (await db
        .insertInto('carrier')
        .values({ text: 'Courier' })
        .returningAll()
        .executeTakeFirstOrThrow());

    const santa = await db
      .insertInto('player')
      .values({
        did: 'did:plc:s2',
        handle: 's2.bsky.social',
        player_type: 'bluesky',
        max_giftees: 1,
        giftee_count: 0,
        profile_complete: 1,
        signup_complete: 1,
        address: '1 St',
        game_mode: 'Regular',
        following_santa_uri: 'at://did:plc:x/app.bsky.graph.follow/3',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const giftee = await db
      .insertInto('player')
      .values({
        did: 'did:plc:g2',
        handle: 'g2.bsky.social',
        player_type: 'bluesky',
        max_giftees: 1,
        giftee_count: 0,
        profile_complete: 1,
        signup_complete: 1,
        address: '2 St',
        game_mode: 'Regular',
        following_santa_uri: 'at://did:plc:x/app.bsky.graph.follow/4',
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

    await db
      .insertInto('tracking')
      .values({
        carrier: carrier.id,
        shipped_date: '2025-12-02',
        tracking_number: 'XYZ',
        giftwrap_status: 1,
        match: match.id,
        tracking_status: 'sent',
        created_at: '2025-12-02T00:00:00Z',
        created_by: 'did:plc:s2',
        deactivated: '2025-12-03',
      })
      .execute();

    const results = await queryTracking(db).execute();
    expect(results).toHaveLength(0);
  });

  it('queryTrackingWithGifteeAndSanta joins all related entities', async () => {
    const db = createDb();
    await migrateToLatest(db);

    const carrier = await db
      .insertInto('carrier')
      .values({ text: `Post${Date.now()}${Math.random()}` })
      .returningAll()
      .executeTakeFirstOrThrow();

    const santa = await db
      .insertInto('player')
      .values({
        did: 'did:plc:s3',
        handle: 's3.bsky.social',
        player_type: 'bluesky',
        max_giftees: 1,
        giftee_count: 0,
        note_count: 5,
        profile_complete: 1,
        signup_complete: 1,
        address: '1 St',
        game_mode: 'Regular',
        following_santa_uri: 'at://did:plc:x/app.bsky.graph.follow/5',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const giftee = await db
      .insertInto('player')
      .values({
        did: 'did:plc:g3',
        handle: 'g3.bsky.social',
        player_type: 'bluesky',
        max_giftees: 1,
        giftee_count: 0,
        note_count: 3,
        profile_complete: 1,
        signup_complete: 1,
        address: '2 St',
        game_mode: 'Regular',
        following_santa_uri: 'at://did:plc:x/app.bsky.graph.follow/6',
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

    await db
      .insertInto('tracking')
      .values({
        carrier: carrier.id,
        shipped_date: '2025-12-04',
        tracking_number: 'TRACK1',
        giftwrap_status: 0,
        match: match.id,
        tracking_status: 'queued',
        created_at: '2025-12-04T00:00:00Z',
        created_by: 'did:plc:s3',
      })
      .execute();

    const results = await queryTrackingWithGifteeAndSanta(db).execute();
    expect(results).toHaveLength(1);
    expect(results[0]!.santa_handle).toBe('s3.bsky.social');
    expect(results[0]!.giftee_handle).toBe('g3.bsky.social');
    expect(results[0]!.santa_note_count).toBe(5);
    expect(results[0]!.giftee_note_count).toBe(3);
    expect(results[0]!.carrier).toBe(carrier.text);
  });
});
