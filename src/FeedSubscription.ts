import { Jetstream, type CommitCreateEvent } from '@skyware/jetstream';

import WebSocket from 'ws';

import type { Database } from './lib/database/index.js';
import { addMinutes, isBefore, parseISO, subDays, subHours } from 'date-fns';
import type { Settings } from './lib/database/schema.js';
import ms from 'ms';

function authorFromPostUri(postUri: string | undefined): string | undefined {
  if (!postUri) return undefined;
  try {
    const parts = postUri.split('/');
    if (parts.length < 3) return undefined;
    return parts[2];
  } catch (e) {
    console.warn(`Error parsing author from post uri ${postUri}: ${e}`);
  }
}

function getHashtags(
  post: CommitCreateEvent<'app.bsky.feed.post'>['commit']['record']
) {
  const hashtags = new Set<string>();
  post.facets?.forEach((facet) =>
    facet.features.forEach((feature) => {
      if (feature.$type === 'app.bsky.richtext.facet#tag') {
        hashtags.add(feature.tag.toLowerCase());
      }
    })
  );
  return hashtags;
}

function boolToDb<T extends Record<string, boolean>>(
  input: T
): { [K in keyof T]: 0 | 1 } {
  return Object.fromEntries(
    Object.entries(input).map(([key, val]) => [key, val ? 1 : 0])
  ) as { [K in keyof T]: 0 | 1 };
}

export class FeedSubscription {
  private gameHashtags: Array<string> = [];
  private jetstream: Jetstream | undefined;
  constructor(private readonly db: Database) {
    setInterval(this.purge.bind(this), ms('1h'));
  }

  async start() {
    const [settings, cursorResult] = await Promise.all([
      this.db
        .selectFrom('settings')
        .select(['hashtag', 'feed_hashtags'])
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('post')
        .select(({ fn }) => fn.max('time_us').as('cursor'))
        .executeTakeFirstOrThrow(),
    ]);
    await this.settingsChanged(settings);
    let cursor = cursorResult.cursor ? cursorResult.cursor : undefined;
    const earliestCursor = subHours(new Date(), 1);
    if (cursor && isBefore(cursor / 1000, earliestCursor)) {
      cursor = earliestCursor.getTime() * 1000;
    }

    this.jetstream = new Jetstream({
      wantedCollections: ['app.bsky.feed.post'],
      ws: WebSocket,
      endpoint: 'wss://jetstream2.us-west.bsky.network/subscribe',
      // TODO: limit max cursor
      cursor,
    });
    this.jetstream.start();

    this.jetstream.onCreate('app.bsky.feed.post', this.onPostCreate.bind(this));
  }

  private async purge() {
    await this.db
      .deleteFrom('post')
      .where('indexedAt', '<', subDays(new Date(), 90).toISOString())
      .execute();
  }

  async settingsChanged(settings: Pick<Settings, 'hashtag' | 'feed_hashtags'>) {
    this.gameHashtags = Array.from(
      new Set(
        settings.feed_hashtags
          .split(',')
          .concat(settings.hashtag)
          .map((tag) => tag.replace(/#/, '').trim().toLowerCase())
      )
    );

    console.log({ gameHashtags: this.gameHashtags });
  }

  async onPostCreate(event: CommitCreateEvent<'app.bsky.feed.post'>) {
    const author = event.did;
    const uri = `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`;
    const replyParent = event.commit.record.reply?.parent.uri;
    const replyParentAuthor = authorFromPostUri(replyParent);

    const hashtags = getHashtags(event.commit.record);
    const hasHashtag =
      this.gameHashtags.find((tag) => hashtags.has(tag)) != null;
    const player = await this.db
      .selectFrom('player')
      .select(['did', 'deactivated', 'booted', 'admin', 'handle'])
      .where('did', '=', author)
      .executeTakeFirst();
    const byPlayer = Boolean(
      player != null && (!player.deactivated || player.admin)
    );
    if (player?.booted && !player.admin) {
      console.log(`dropping post from booted player ${player.handle}`);
    }

    let distanceFromHashtag = hasHashtag ? 0 : -1;
    let distanceFromPlayerWithHashtag = hasHashtag && byPlayer ? 0 : -1;

    let rootByPlayerWithHashtag = false;
    if (replyParent) {
      const parentPost = await this.db
        .selectFrom('post')
        .selectAll()
        .where('uri', '=', replyParent)
        .executeTakeFirst();
      if (parentPost != null) {
        distanceFromHashtag = hasHashtag
          ? 0
          : parentPost.distanceFromHashtag === -1
            ? -1
            : parentPost.distanceFromHashtag + 1;
        distanceFromPlayerWithHashtag =
          hasHashtag && byPlayer
            ? 0
            : parentPost.distanceFromPlayerWithHashtag === -1
              ? -1
              : parentPost.distanceFromPlayerWithHashtag + 1;
        rootByPlayerWithHashtag = parentPost.replyParent
          ? Boolean(parentPost.rootByPlayerWithHashtag)
          : Boolean(parentPost.hasHashtag && parentPost.byPlayer);
      }
    }

    if (distanceFromHashtag < 0 && !byPlayer) {
      return;
    }

    const now = new Date();
    let indexedAtDate = now;
    try {
      const createdAt = parseISO(event.commit.record.createdAt);
      indexedAtDate = createdAt;
      if (isBefore(addMinutes(now, 1), indexedAtDate)) {
        console.warn(
          `Ignoring future create date ${event.commit.record.createdAt} on post by ${author}, using ${now.toISOString()} instead`
        );
        indexedAtDate = now;
      }
      if (isBefore(indexedAtDate, subDays(now, 7))) {
        console.warn(
          `Dropping post by ${author} with create date ${event.commit.record.createdAt} more than 7 days ago`
        );
        return;
      }
    } catch (e) {
      console.warn(
        `Ignoring unparsable create date ${event.commit.record.createdAt} on post by ${author}, using ${now.toISOString()} instead`
      );
      indexedAtDate = now;
    }

    await this.db
      .insertInto('post')
      .values({
        uri,
        author,
        replyParent,
        replyParentAuthor,
        indexedAt: indexedAtDate.toISOString(),
        time_us: event.time_us,
        ...boolToDb({
          hasHashtag,
          byPlayer,
          rootByPlayerWithHashtag,
        }),
        distanceFromHashtag,
        distanceFromPlayerWithHashtag,
      })
      .onConflict((cb) => cb.doNothing())
      .execute();
  }
}
