import type { PlayerService } from './lib/PlayerService.js';
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

  constructor(private readonly playerService: PlayerService) {
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

      await Promise.all(
        eventsByType.follows.deletes.map((follow) =>
          this.playerService.removeFollow(follow.uri)
        )
      );

      await Promise.all(
        eventsByType.follows.creates.map((follow) =>
          this.playerService.recordFollow(
            follow.author,
            follow.record.subject,
            follow.uri
          )
        )
      );
    } else if (ComAtprotoSyncSubscribeRepos.isHandle(evt)) {
      await this.playerService.updateHandle(evt.did, evt.handle);
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
