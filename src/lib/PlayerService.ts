/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
  AppBskyGraphDefs,
  type AppBskyGraphGetRelationships,
} from '@atproto/api';
import { getSantaBskyAgent, unauthenticatedAgent } from '../bluesky.js';
import type { Database } from './database/index.js';
import fetch from 'node-fetch';
import { InternalServerError } from 'http-errors-enhanced';

import type { Player as DbPlayer } from './database/schema.js';
import ms from 'ms';

export type Player = Omit<
  DbPlayer,
  'following_santa_uri' | 'santa_following_uri' | 'signup_complete'
> & { following_santa: boolean; signup_complete: boolean };

const fetchRelationships = async (
  santaDid: string,
  playerDid: string
): Promise<AppBskyGraphGetRelationships.OutputSchema> => {
  if (santaDid === playerDid) {
    return {
      relationships: [
        {
          $type: 'app.bsky.graph.defs#relationship',
          did: playerDid,
          followedBy: 'self',
          following: 'self',
        },
      ],
    };
  }
  const uri = new URL(
    'https://public.api.bsky.app/xrpc/app.bsky.graph.getRelationships'
  );
  uri.searchParams.set('actor', santaDid);
  uri.searchParams.set('others', playerDid);
  uri.searchParams.set('cacheBust', new Date().toISOString());
  const result = await fetch(uri.toString());
  if (!result.ok) {
    throw new InternalServerError(
      `Unable to fetch relationship [${result.status}]: ${await result.text()}`
    );
  }
  return (await result.json()) as AppBskyGraphGetRelationships.OutputSchema;
};

type WebhookNotifier<T> = (body: T) => Promise<void>;

const buildWebhookNotifier = <T>(
  hookUrl: string | undefined,
  description: string
): WebhookNotifier<T> =>
  hookUrl == null
    ? async (body: T) => {
        console.log(`Notify ${description}: ${JSON.stringify(body)}`);
      }
    : async (body: T) => {
        const result = await fetch(hookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        await result.text();
        console.log(`Notify ${description}: ${JSON.stringify(body)}`);
      };

const getAuthorFromUri = (postUri: string | undefined) => {
  if (postUri == null) return undefined;
  const [, , repo] = postUri.split('/');
  return repo;
};

export class PlayerService {
  private readonly followingChangedWebhook: WebhookNotifier<{
    player_did: string;
    following_santa: boolean;
  }>;
  private readonly handleChangedWebhook: WebhookNotifier<{
    player_did: string;
    old_handle: string;
    new_handle: string;
  }>;

  constructor(
    private readonly db: Database,
    private readonly santaAccountDid: string
  ) {
    this.followingChangedWebhook = buildWebhookNotifier(
      process.env.FOLLOWING_CHANGED_WEBHOOK,
      'following changed'
    );
    this.handleChangedWebhook = buildWebhookNotifier(
      process.env.HANDLE_CHANGED_WEBHOOK,
      'handle changed'
    );

    setInterval(this.followPlayers.bind(this), ms('1 hour'));
  }

  private async followPlayers() {
    const playersToFollow = await this.db
      .selectFrom('player')
      .select(['did', 'handle'])
      .where('santa_following_uri', 'is', null)
      .where('signup_complete', '=', 1)
      .limit(4)
      .execute();
    console.log(`Found ${playersToFollow.length} players to follow`);

    const santaAgent = await getSantaBskyAgent();
    for (const { did, handle } of playersToFollow) {
      try {
        console.log(`Following ${handle} (${did})`);
        const { uri } = await santaAgent.follow(did);
        await this.recordFollow(this.santaAccountDid, did, uri);
      } catch (error) {
        // @ts-expect-error
        console.error(`Error following ${handle} (${did}): ${error.message}`);
        await this.db
          .updateTable('player')
          .set({
            // @ts-expect-error
            santa_following_uri: `Error: ${error.message}`,
          })
          .where('did', '=', did)
          .executeTakeFirst();
      }
    }
  }

  async createPlayer(
    player_did: string,
    signup_complete: boolean
  ): Promise<Player> {
    const [{ data: profile }, { relationships }] = await Promise.all([
      unauthenticatedAgent.getProfile({
        actor: player_did,
      }),
      fetchRelationships(this.santaAccountDid, player_did),
    ]);
    const relationship = AppBskyGraphDefs.isRelationship(relationships[0])
      ? relationships[0]
      : undefined;

    const player: DbPlayer = {
      did: player_did,
      handle: profile.handle,
      signup_complete: signup_complete ? 1 : 0,
      following_santa_uri: relationship?.followedBy ?? null,
      santa_following_uri: relationship?.following ?? null,
    };

    await this.db
      .insertInto('player')
      .values(player)
      .onConflict((oc) => oc.column('did').doUpdateSet(player))
      .execute();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { following_santa_uri, santa_following_uri, ...rest } = player;
    return {
      ...rest,
      following_santa: following_santa_uri != null,
      signup_complete: Boolean(signup_complete),
    };
  }

  async deletePlayer(player_did: string): Promise<void> {
    await this.db.deleteFrom('player').where('did', '=', player_did).execute();
  }

  async recordFollow(
    authorDid: string,
    followedDid: string,
    followUri: string
  ) {
    if (authorDid === this.santaAccountDid) {
      await this.db
        .updateTable('player')
        .set({
          santa_following_uri: followUri,
        })
        .where('did', '=', followedDid)
        .executeTakeFirst();
    } else if (followedDid === this.santaAccountDid) {
      const updatedPlayer = await this.db
        .updateTable('player')
        .set({
          following_santa_uri: followUri,
        })
        .where('did', '=', authorDid)
        .returningAll()
        .executeTakeFirst();
      if (updatedPlayer != null) {
        await this.followingChangedWebhook({
          player_did: updatedPlayer.did,
          following_santa: true,
        });
      }
    }
  }

  async removeFollow(followUri: string) {
    const santaAgent = await getSantaBskyAgent();
    const santaAccountDid = santaAgent.session?.did;
    const author = getAuthorFromUri(followUri);
    if (author === santaAccountDid) {
      await this.db
        .updateTable('player')
        .set({
          santa_following_uri: null,
        })
        .where('santa_following_uri', '=', followUri)
        .executeTakeFirst();
    } else {
      const deleteFollowResult = await this.db
        .updateTable('player')
        .set({
          following_santa_uri: null,
        })
        .where('following_santa_uri', '=', followUri)
        .returningAll()
        .executeTakeFirst();
      if (deleteFollowResult != null) {
        await this.followingChangedWebhook({
          player_did: deleteFollowResult.did,
          following_santa: false,
        });
      }
    }
  }

  async updateHandle(playerDid: string, newHandle: string) {
    const record = await this.db
      .selectFrom('player')
      .select('handle')
      .where('did', '=', playerDid)
      .where('signup_complete', '=', 1)
      .executeTakeFirst();
    if (record != null && newHandle !== record.handle) {
      await this.handleChangedWebhook({
        player_did: playerDid,
        old_handle: record.handle,
        new_handle: newHandle,
      });
      await this.db
        .updateTable('player')
        .set({ handle: newHandle })
        .where('did', '=', playerDid)
        .execute();
    }
  }
}
