import type { Database } from './lib/database/index.js';
import {
  FirehoseSubscriptionBase,
  getOpsByType,
  type CreateOp,
  type RepoEvent,
} from './util/subscription.js';
import { AppBskyFeedPost, ComAtprotoSyncSubscribeRepos } from '@atproto/api';
import fetch from 'node-fetch';

type MatchedPostCallback = (
  post: CreateOp<AppBskyFeedPost.Record>,
  matches: RegExpMatchArray
) => void;
export class Subscription extends FirehoseSubscriptionBase {
  private postMatchers: Array<{
    matcher: RegExp;
    callback: MatchedPostCallback;
  }> = [];

  constructor(private readonly db: Database) {
    super('wss://bsky.network');
  }

  override async handleEvent(evt: RepoEvent) {
    if (ComAtprotoSyncSubscribeRepos.isCommit(evt)) {
      const eventsByType = await getOpsByType(evt);
      for (const post of eventsByType.posts.creates) {
        for (const { matcher, callback } of this.postMatchers) {
          const match = matcher.exec(post.record.text);
          if (match != null) {
            callback(post, match);
          }
        }
      }
    } else if (ComAtprotoSyncSubscribeRepos.isHandle(evt)) {
      const record = await this.db
        .selectFrom('player')
        .select('handle')
        .where('did', '=', evt.did)
        .executeTakeFirst();
      if (record != null && evt.handle !== record.handle) {
        const handleChangedWebhook = process.env.HANDLE_CHANGED_WEBHOOK;
        if (handleChangedWebhook) {
          const result = await fetch(handleChangedWebhook, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              player_did: evt.did,
              old_handle: record.handle,
              new_handle: evt.handle,
            }),
          });
          await result.text();
          console.log(`Notify Make ${record.handle} => ${evt.handle}`);
        } else {
          console.log(
            `(SKIPPED) Notify Make ${record.handle} => ${evt.handle}`
          );
        }
        await this.db
          .updateTable('player')
          .set({ handle: evt.handle })
          .where('did', '=', evt.did)
          .execute();
      }
    }
  }

  onPostMatching(matcher: RegExp, callback: MatchedPostCallback) {
    const matcherObj = { matcher, callback };
    this.postMatchers.push(matcherObj);
    return () => {
      this.postMatchers = this.postMatchers.filter(
        (test) => test !== matcherObj
      );
    };
  }
}
