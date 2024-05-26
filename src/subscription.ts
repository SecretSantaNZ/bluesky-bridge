import {
  FirehoseSubscriptionBase,
  getOpsByType,
  type CreateOp,
  type RepoEvent,
} from './util/subscription.js';
import { AppBskyFeedPost, ComAtprotoSyncSubscribeRepos } from '@atproto/api';

type MatchedPostCallback = (
  post: CreateOp<AppBskyFeedPost.Record>,
  matches: RegExpMatchArray
) => void;
export class Subscription extends FirehoseSubscriptionBase {
  private postMatchers: Array<{
    matcher: RegExp;
    callback: MatchedPostCallback;
  }> = [];

  constructor() {
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
    } else if (ComAtprotoSyncSubscribeRepos.isIdentity(evt)) {
      // Implement handle changed
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
