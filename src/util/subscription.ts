import { Subscription } from '@atproto/xrpc-server';
import { cborToLexRecord, readCar } from '@atproto/repo';
// import { ids, lexicons } from '../lexicon/lexicons';
import {
  ComAtprotoSyncSubscribeRepos,
  AppBskyFeedPost,
  AppBskyFeedRepost,
  AppBskyFeedLike,
  AppBskyGraphFollow,
} from '@atproto/api';

import { unauthenticatedAgent } from '../bluesky.js';

const lex = unauthenticatedAgent.api.xrpc.baseClient.lex;

export type RepoEvent =
  | ComAtprotoSyncSubscribeRepos.Commit
  | { $type: string; [k: string]: unknown };

const ids = {
  ComAtprotoSyncSubscribeRepos: 'com.atproto.sync.subscribeRepos',
  AppBskyFeedPost: 'app.bsky.feed.post',
  AppBskyFeedRepost: 'app.bsky.feed.repost',
  AppBskyFeedLike: 'app.bsky.feed.like',
  AppBskyGraphFollow: 'app.bsky.graph.follow',
};

export abstract class FirehoseSubscriptionBase {
  public sub: Subscription<RepoEvent>;

  constructor(
    // public db: Database,
    public service: string
  ) {
    this.sub = new Subscription({
      service: service,
      method: ids.ComAtprotoSyncSubscribeRepos,
      getParams: () => this.getCursor(),
      validate: (value: unknown) => {
        try {
          return lex.assertValidXrpcMessage<RepoEvent>(
            ids.ComAtprotoSyncSubscribeRepos,
            value
          );
        } catch (err) {
          console.error('repo subscription skipped invalid message', err);
        }
      },
    });
  }

  abstract handleEvent(evt: RepoEvent): Promise<void>;

  async run(subscriptionReconnectDelay: number) {
    try {
      for await (const evt of this.sub) {
        try {
          await this.handleEvent(evt);
        } catch (err) {
          console.error('repo subscription could not handle message', err);
        }
        // update stored cursor every 20 events or so
        if (ComAtprotoSyncSubscribeRepos.isCommit(evt) && evt.seq % 20 === 0) {
          await this.updateCursor(evt.seq);
        }
      }
    } catch (err) {
      console.error('repo subscription errored', err);
      setTimeout(
        () => this.run(subscriptionReconnectDelay),
        subscriptionReconnectDelay
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async updateCursor(cursor: number) {
    // await this.db
    //   .updateTable('sub_state')
    //   .set({ cursor })
    //   .where('service', '=', this.service)
    //   .execute();
  }

  async getCursor(): Promise<{ cursor?: number }> {
    // const res = await this.db
    //   .selectFrom('sub_state')
    //   .selectAll()
    //   .where('service', '=', this.service)
    //   .executeTakeFirst();
    // if (!res) {
    //   await this.db
    //     .insertInto('sub_state')
    //     .values({
    //       service: this.service,
    //       cursor: 0,
    //     })
    //     .execute();
    // }
    // return res ? { cursor: res.cursor } : {};
    return {};
  }
}

export const getOpsByType = async (
  evt: ComAtprotoSyncSubscribeRepos.Commit
): Promise<OperationsByType> => {
  const car = await readCar(evt.blocks);
  const opsByType: OperationsByType = {
    posts: { creates: [], deletes: [] },
    reposts: { creates: [], deletes: [] },
    likes: { creates: [], deletes: [] },
    follows: { creates: [], deletes: [] },
  };

  for (const op of evt.ops) {
    const uri = `at://${evt.repo}/${op.path}`;
    const [collection] = op.path.split('/');

    if (op.action === 'update') continue; // updates not supported yet

    if (op.action === 'create') {
      if (!op.cid) continue;
      const recordBytes = car.blocks.get(op.cid);
      if (!recordBytes) continue;
      const record = cborToLexRecord(recordBytes);
      const create = { uri, cid: op.cid.toString(), author: evt.repo };
      if (
        collection === ids.AppBskyFeedPost &&
        AppBskyFeedPost.isRecord(record)
      ) {
        opsByType.posts.creates.push({ record, ...create });
      } else if (
        collection === ids.AppBskyFeedRepost &&
        AppBskyFeedRepost.isRecord(record)
      ) {
        opsByType.reposts.creates.push({ record, ...create });
      } else if (
        collection === ids.AppBskyFeedLike &&
        AppBskyFeedLike.isRecord(record)
      ) {
        opsByType.likes.creates.push({ record, ...create });
      } else if (
        collection === ids.AppBskyGraphFollow &&
        AppBskyGraphFollow.isRecord(record)
      ) {
        opsByType.follows.creates.push({ record, ...create });
      }
    }

    if (op.action === 'delete') {
      if (collection === ids.AppBskyFeedPost) {
        opsByType.posts.deletes.push({ uri });
      } else if (collection === ids.AppBskyFeedRepost) {
        opsByType.reposts.deletes.push({ uri });
      } else if (collection === ids.AppBskyFeedLike) {
        opsByType.likes.deletes.push({ uri });
      } else if (collection === ids.AppBskyGraphFollow) {
        opsByType.follows.deletes.push({ uri });
      }
    }
  }

  return opsByType;
};

type OperationsByType = {
  posts: Operations<AppBskyFeedPost.Record>;
  reposts: Operations<AppBskyFeedRepost.Record>;
  likes: Operations<AppBskyFeedLike.Record>;
  follows: Operations<AppBskyGraphFollow.Record>;
};

type Operations<T = Record<string, unknown>> = {
  creates: CreateOp<T>[];
  deletes: DeleteOp[];
};

export type CreateOp<T> = {
  uri: string;
  cid: string;
  author: string;
  record: T;
};

type DeleteOp = {
  uri: string;
};
