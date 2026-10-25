import { describe, expect, it } from 'vitest';
import { createDb, migrateToLatest } from './index.js';
import { loadPlayersWhoCanHaveMoreGifees } from './loadPlayersWhoCanHaveMoreGifees.js';

describe('loadPlayersWhoCanHaveMoreGifees', () => {
  it('returns players who can have more giftees and are signup complete', async () => {
    const db = createDb();
    await migrateToLatest(db);

    await db
      .insertInto('player')
      .values({
        did: 'did:plc:1',
        handle: 'alice.bsky.social',
        player_type: 'bluesky',
        max_giftees: 3,
        giftee_count: 1,
        giftee_count_status: 'can_have_more',
        signup_complete: 1,
        game_mode: 'Regular',
        address: '123 Main St',
        profile_complete: 1,
        following_santa_uri: 'at://did:plc:santa/app.bsky.graph.follow/123',
        opted_out: null,
        booted: null,
        avatar_url: 'https://example.com/alice.jpg',
        note_count: 0,
      })
      .execute();

    await db
      .insertInto('player')
      .values({
        did: 'did:plc:2',
        handle: 'bob.bsky.social',
        player_type: 'bluesky',
        max_giftees: 3,
        giftee_count: 3,
        giftee_count_status: 'full',
        signup_complete: 1,
        game_mode: 'Regular',
        address: '456 Main St',
        profile_complete: 1,
        following_santa_uri: 'at://did:plc:santa/app.bsky.graph.follow/456',
        opted_out: null,
        booted: null,
        avatar_url: 'https://example.com/bob.jpg',
        note_count: 1,
      })
      .execute();

    await db
      .insertInto('player')
      .values({
        did: 'did:plc:3',
        handle: 'carol.bsky.social',
        player_type: 'bluesky',
        max_giftees: 3,
        giftee_count: 0,
        giftee_count_status: 'can_have_more',
        signup_complete: 0,
        game_mode: 'Regular',
        address: null,
        profile_complete: 0,
        following_santa_uri: null,
        opted_out: null,
        booted: null,
        note_count: 0,
      })
      .execute();

    const players = await loadPlayersWhoCanHaveMoreGifees(db);

    expect(players).toHaveLength(1);
    expect(players[0]!.handle).toBe('alice.bsky.social');
    expect(players[0]!.did).toBe('did:plc:1');
    expect(players[0]!.giftee_count).toBe(1);
    expect(players[0]!.max_giftees).toBe(3);
  });
});
