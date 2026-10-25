import { describe, expect, it } from 'vitest';
import {
  createDb,
  migrateToLatest,
  type Database,
} from '../../lib/database/index.js';
import type { DatabaseSchema } from '../../lib/database/schema.js';
import type { InsertObject } from 'kysely';
import { buildFeedUris, getFeedSkeletonOutput } from './index.js';
import { BadRequestError } from 'http-errors-enhanced';

const SANTA_DID = 'did:plc:santa';
const USER_DID = 'did:plc:user';

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
      did: `did:plc:${overrides.did ?? handle}`,
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

async function insertPost(
  db: Database,
  overrides: Partial<InsertObject<DatabaseSchema, 'post'>> & { uri: string }
) {
  return await db
    .insertInto('post')
    .values({
      author: 'did:plc:someone',
      time_us: 1000,
      hasHashtag: 0,
      byPlayer: 0,
      distanceFromHashtag: 99,
      distanceFromPlayerWithHashtag: 99,
      rootByPlayerWithHashtag: 0,
      indexedAt: '2025-12-01T00:00:00.000Z',
      ...overrides,
    })
    .execute();
}

async function insertMatch(
  db: Database,
  santaDid: string,
  gifteeDid: string,
  matchStatus: 'draft' | 'shared' | 'locked' = 'locked'
) {
  const santa = await insertPlayer(db, {
    handle: `${santaDid}.h`,
    did: santaDid,
  });
  const giftee = await insertPlayer(db, {
    handle: `${gifteeDid}.h`,
    did: gifteeDid,
  });
  return await db
    .insertInto('match')
    .values({
      santa: santa.id,
      giftee: giftee.id,
      has_present: 0,
      invalid_player: 0,
      match_status: matchStatus,
      nudge_count: 0,
      nudge_present_update_count: 0,
      tracking_count: 0,
      tracking_missing_count: 0,
      super_santa_match: 0,
    })
    .execute();
}

describe('buildFeedUris', () => {
  it('builds one uri per generator feed', () => {
    const uris = buildFeedUris('did:plc:santa');
    expect(uris.gifteeFeedUri).toBe(
      'at://did:plc:santa/app.bsky.feed.generator/3lgklut3vkw6t'
    );
    expect(uris.hashtagFeedUri).toBe(
      'at://did:plc:santa/app.bsky.feed.generator/3lgmzql3sv6vk'
    );
    expect(uris.hashtagWithRepliesFeedUri).toBe(
      'at://did:plc:santa/app.bsky.feed.generator/3lgmzr7qohmva'
    );
  });
});

describe('getFeedSkeletonOutput', () => {
  it('rejects unknown feeds', async () => {
    const db = await setupDb();
    await expect(
      getFeedSkeletonOutput(
        db,
        await db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
        SANTA_DID,
        { feed: 'at://unknown', userDid: USER_DID }
      )
    ).rejects.toThrow(BadRequestError);
  });

  it('hashtag feed serves santa top-level posts plus hashtagged posts', async () => {
    const db = await setupDb();
    const { hashtagFeedUri } = buildFeedUris(SANTA_DID);
    await insertPost(db, {
      uri: 'at://post/santa-nonreply',
      author: SANTA_DID,
      replyParent: null,
    });
    await insertPost(db, {
      uri: 'at://post/santa-reply',
      author: SANTA_DID,
      replyParent: 'at://post/parent',
    });
    await insertPost(db, {
      uri: 'at://post/hashtagged',
      author: 'did:plc:other',
      hasHashtag: 1,
      byPlayer: 0,
    });
    await insertPost(db, {
      uri: 'at://post/plain',
      author: 'did:plc:other',
      hasHashtag: 0,
    });

    const output = await getFeedSkeletonOutput(
      db,
      await db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
      SANTA_DID,
      { feed: hashtagFeedUri, userDid: USER_DID }
    );
    const posts = output.feed.map(({ post }) => post as string).sort();
    expect(posts).toEqual(['at://post/hashtagged', 'at://post/santa-nonreply']);
  });

  it('hashtag feed can be restricted to player posts', async () => {
    const db = await setupDb();
    const { hashtagFeedUri } = buildFeedUris(SANTA_DID);
    await db
      .updateTable('settings')
      .set({ feed_player_only: 1 })
      .where('id', '=', 0)
      .execute();
    await insertPost(db, {
      uri: 'at://post/by-player',
      author: 'did:plc:other',
      hasHashtag: 1,
      byPlayer: 1,
    });
    await insertPost(db, {
      uri: 'at://post/by-non-player',
      author: 'did:plc:other',
      hasHashtag: 1,
      byPlayer: 0,
    });

    const output = await getFeedSkeletonOutput(
      db,
      await db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
      SANTA_DID,
      { feed: hashtagFeedUri, userDid: USER_DID }
    );
    expect(output.feed.map(({ post }) => post)).toEqual([
      'at://post/by-player',
    ]);
  });

  it('hashtag-with-replies feed lights up player descendants of players with hashtags', async () => {
    const db = await setupDb();
    const { hashtagWithRepliesFeedUri } = buildFeedUris(SANTA_DID);
    await insertPost(db, {
      uri: 'at://post/near',
      author: 'did:plc:other',
      distanceFromHashtag: 2,
      distanceFromPlayerWithHashtag: 2,
    });
    await insertPost(db, {
      uri: 'at://post/far',
      author: 'did:plc:other',
      distanceFromHashtag: 9,
      distanceFromPlayerWithHashtag: 9,
    });

    const output = await getFeedSkeletonOutput(
      db,
      await db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
      SANTA_DID,
      { feed: hashtagWithRepliesFeedUri, userDid: USER_DID }
    );
    expect(output.feed.map(({ post }) => post)).toEqual(['at://post/near']);
  });

  it('hashtag-with-replies feed respects the distance limit when restricted to players', async () => {
    const db = await setupDb();
    const { hashtagWithRepliesFeedUri } = buildFeedUris(SANTA_DID);
    await db
      .updateTable('settings')
      .set({ feed_player_only: 1 })
      .where('id', '=', 0)
      .execute();
    await insertPost(db, {
      uri: 'at://post/near-player',
      author: 'did:plc:other',
      byPlayer: 1,
      distanceFromPlayerWithHashtag: 3,
    });
    await insertPost(db, {
      uri: 'at://post/far-player',
      author: 'did:plc:other',
      byPlayer: 1,
      distanceFromPlayerWithHashtag: 8,
    });

    const output = await getFeedSkeletonOutput(
      db,
      await db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
      SANTA_DID,
      { feed: hashtagWithRepliesFeedUri, userDid: USER_DID }
    );
    expect(output.feed.map(({ post }) => post)).toEqual([
      'at://post/near-player',
    ]);
  });

  it('giftee feed serves a sentinel post when the user has no giftees', async () => {
    const db = await setupDb();
    const { gifteeFeedUri } = buildFeedUris(SANTA_DID);
    await insertPost(db, { uri: 'at://post/any', hasHashtag: 1 });

    const output = await getFeedSkeletonOutput(
      db,
      await db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
      SANTA_DID,
      { feed: gifteeFeedUri, userDid: USER_DID }
    );
    expect(output.feed.map(({ post }) => post)).toEqual([
      'at://did:plc:qaspeclp3zntiiaywz57zwza/app.bsky.feed.post/3lgn2zw3u2k2u',
    ]);
  });

  it('giftee feed serves gift recipients posts from non-draft matches', async () => {
    const db = await setupDb();
    const { gifteeFeedUri } = buildFeedUris(SANTA_DID);
    await insertMatch(db, USER_DID, 'did:plc:giftee');
    await insertPost(db, {
      uri: 'at://post/by-giftee',
      author: 'did:plc:giftee',
    });
    await insertPost(db, {
      uri: 'at://post/by-stranger',
      author: 'did:plc:stranger',
    });

    const output = await getFeedSkeletonOutput(
      db,
      await db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
      SANTA_DID,
      { feed: gifteeFeedUri, userDid: USER_DID }
    );
    expect(output.feed.map(({ post }) => post)).toEqual([
      'at://post/by-giftee',
    ]);
  });

  it('giftee feed does not serve posts for draft matches', async () => {
    const db = await setupDb();
    const { gifteeFeedUri } = buildFeedUris(SANTA_DID);
    await insertMatch(db, USER_DID, 'did:plc:giftee', 'draft');
    await insertPost(db, {
      uri: 'at://post/by-draft-giftee',
      author: 'did:plc:giftee',
    });

    const output = await getFeedSkeletonOutput(
      db,
      await db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
      SANTA_DID,
      { feed: gifteeFeedUri, userDid: USER_DID }
    );
    const posts = output.feed.map(({ post }) => post);
    expect(posts).toEqual([
      // Giftee list is empty so the no-giftee sentinel is served
      'at://did:plc:qaspeclp3zntiiaywz57zwza/app.bsky.feed.post/3lgn2zw3u2k2u',
    ]);
  });

  it('giftee feed does not serve posts for matches with a different santa', async () => {
    const db = await setupDb();
    const { gifteeFeedUri } = buildFeedUris(SANTA_DID);
    await insertMatch(db, USER_DID, 'did:plc:own-giftee');
    await insertMatch(db, 'did:plc:other-santa', 'did:plc:other-giftee');
    await insertPost(db, {
      uri: 'at://post/by-own-giftee',
      author: 'did:plc:own-giftee',
    });
    await insertPost(db, {
      uri: 'at://post/by-other-giftee',
      author: 'did:plc:other-giftee',
    });

    const output = await getFeedSkeletonOutput(
      db,
      await db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
      SANTA_DID,
      { feed: gifteeFeedUri, userDid: USER_DID }
    );
    expect(output.feed.map(({ post }) => post)).toEqual([
      'at://post/by-own-giftee',
    ]);
  });

  it('giftee feed serves a sentinel post when giftees have not posted', async () => {
    const db = await setupDb();
    const { gifteeFeedUri } = buildFeedUris(SANTA_DID);
    await insertMatch(db, USER_DID, 'did:plc:giftee');

    const output = await getFeedSkeletonOutput(
      db,
      await db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
      SANTA_DID,
      { feed: gifteeFeedUri, userDid: USER_DID }
    );
    expect(output.feed.map(({ post }) => post)).toEqual([
      'at://did:plc:qaspeclp3zntiiaywz57zwza/app.bsky.feed.post/3lgn345mw2k2u',
    ]);
  });

  it('paginates with cursor and only emits a cursor when there are more pages', async () => {
    const db = await setupDb();
    const { gifteeFeedUri } = buildFeedUris(SANTA_DID);
    await insertMatch(db, USER_DID, 'did:plc:giftee');
    for (let i = 0; i < 5; i++) {
      await insertPost(db, {
        uri: `at://post/by-giftee-${i}`,
        author: 'did:plc:giftee',
        indexedAt: `2025-12-01T00:0${i}:00.000Z`,
      });
    }

    const settings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();
    const pageOne = await getFeedSkeletonOutput(db, settings, SANTA_DID, {
      feed: gifteeFeedUri,
      userDid: USER_DID,
      limit: 2,
    });
    expect(pageOne.feed).toHaveLength(2);
    expect(pageOne.feed.map(({ post }) => post)).toEqual([
      'at://post/by-giftee-4',
      'at://post/by-giftee-3',
    ]);
    expect(pageOne.cursor).toBe('2');

    const pageTwo = await getFeedSkeletonOutput(db, settings, SANTA_DID, {
      feed: gifteeFeedUri,
      userDid: USER_DID,
      limit: 2,
      cursor: pageOne.cursor,
    });
    expect(pageTwo.feed.map(({ post }) => post)).toEqual([
      'at://post/by-giftee-2',
      'at://post/by-giftee-1',
    ]);
    expect(pageTwo.cursor).toBe('4');

    const lastPage = await getFeedSkeletonOutput(db, settings, SANTA_DID, {
      feed: gifteeFeedUri,
      userDid: USER_DID,
      limit: 2,
      cursor: pageTwo.cursor,
    });
    expect(lastPage.feed.map(({ post }) => post)).toEqual([
      'at://post/by-giftee-0',
    ]);
    expect(lastPage.cursor).toBeUndefined();
  });
});
