import { describe, expect, it } from 'vitest';
import { createDb, migrateToLatest } from './index.js';
import { queryFullMatch } from './match.js';

describe('queryFullMatch', () => {
  it('returns active matches with santa and giftee joined', async () => {
    const db = createDb();
    await migrateToLatest(db);

    const santa = await db
      .insertInto('player')
      .values({
        did: 'did:plc:santa',
        handle: 'santa.bsky.social',
        player_type: 'bluesky',
        max_giftees: 3,
        giftee_count: 1,
        signup_complete: 1,
        address: '1 Santa St',
        profile_complete: 1,
        following_santa_uri: 'at://did:plc:secret/app.bsky.graph.follow/1',
        avatar_url: 'santa.jpg',
        note_count: 2,
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
        signup_complete: 1,
        address: '2 Giftee St',
        profile_complete: 1,
        following_santa_uri: 'at://did:plc:secret/app.bsky.graph.follow/2',
        avatar_url: 'giftee.jpg',
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

    const matches = await queryFullMatch(db).execute();

    expect(matches).toHaveLength(1);
    expect(matches[0]!.match_id).toBe(match.id);
    expect(matches[0]!.santa_id).toBe(santa.id);
    expect(matches[0]!.santa_handle).toBe('santa.bsky.social');
    expect(matches[0]!.giftee_id).toBe(giftee.id);
    expect(matches[0]!.giftee_handle).toBe('giftee.bsky.social');
    expect(matches[0]!.match_status).toBe('shared');
  });

  it('filters out deactivated matches', async () => {
    const db = createDb();
    await migrateToLatest(db);

    const santa = await db
      .insertInto('player')
      .values({
        did: 'did:plc:santa2',
        handle: 'santa2.bsky.social',
        player_type: 'bluesky',
        max_giftees: 3,
        giftee_count: 0,
        signup_complete: 1,
        profile_complete: 1,
        address: '1 Santa St',
        game_mode: 'Regular',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const giftee = await db
      .insertInto('player')
      .values({
        did: 'did:plc:giftee2',
        handle: 'giftee2.bsky.social',
        player_type: 'bluesky',
        max_giftees: 1,
        giftee_count: 0,
        signup_complete: 1,
        profile_complete: 1,
        address: '2 Giftee St',
        game_mode: 'Regular',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto('match')
      .values({
        santa: santa.id,
        giftee: giftee.id,
        has_present: 0,
        invalid_player: 0,
        match_status: 'draft',
        nudge_count: 0,
        nudge_present_update_count: 0,
        tracking_count: 0,
        tracking_missing_count: 0,
        super_santa_match: 0,
        posted_opening: 0,
        deactivated: '2025-12-01',
      })
      .execute();

    const matches = await queryFullMatch(db).execute();
    expect(matches).toHaveLength(0);
  });
});
