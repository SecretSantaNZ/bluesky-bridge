/* eslint-disable @typescript-eslint/ban-ts-comment */
import newrelic from 'newrelic';
import {
  Agent,
  AppBskyGraphDefs,
  type AppBskyGraphGetRelationships,
} from '@atproto/api';
import { unauthenticatedAgent } from '../bluesky.js';
import { queryFullMatch, type Database } from './database/index.js';
import fetch from 'node-fetch';
import { InternalServerError } from 'http-errors-enhanced';

import type {
  DatabaseSchema,
  Player as DbPlayer,
  Settings,
} from './database/schema.js';
import ms from 'ms';
import type { InsertObject, SelectType } from 'kysely';
import type { DmSender } from './DmSender.js';

type SelectedPlayer = {
  [K in keyof DbPlayer]: SelectType<DbPlayer[K]>;
};

export type PlayersChangedListener = () => unknown;

export type Player = Omit<
  SelectedPlayer,
  | 'following_santa_uri'
  | 'santa_following_uri'
  | 'profile_complete'
  | 'signup_complete'
  | 'address_review_required'
  | 'opted_out'
> & {
  following_santa: boolean;
  profile_complete: boolean;
  signup_complete: boolean;
  address_review_required: boolean;
  opted_out: boolean;
};

const dbPlayerToPlayer = (dbPlayer: SelectedPlayer): Player => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { following_santa_uri, santa_following_uri, id, ...rest } = dbPlayer;
  return {
    ...rest,
    id,
    following_santa: following_santa_uri != null,
    profile_complete: Boolean(rest.profile_complete),
    signup_complete: Boolean(rest.signup_complete),
    address_review_required: Boolean(rest.address_review_required),
    opted_out: Boolean(rest.opted_out),
  };
};

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
  private listeners: Array<PlayersChangedListener> = [];
  private readonly followingChangedWebhook: WebhookNotifier<{
    player_did: string;
    following_santa: boolean;
  }>;
  private readonly handleChangedWebhook: WebhookNotifier<{
    player_did: string;
    old_handle: string;
    new_handle: string;
  }>;
  private autoFollowIntervalHandle?: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: Database,
    private readonly santaAgent: () => Promise<Agent>,
    private readonly santaAccountDid: string,
    private readonly dmSender: DmSender
  ) {
    this.followingChangedWebhook = buildWebhookNotifier(
      process.env.FOLLOWING_CHANGED_WEBHOOK,
      'following changed'
    );
    this.handleChangedWebhook = buildWebhookNotifier(
      process.env.HANDLE_CHANGED_WEBHOOK,
      'handle changed'
    );

    this.init();
  }

  private async init() {
    const settings = await this.db
      .selectFrom('settings')
      .select('auto_follow')
      .executeTakeFirstOrThrow();
    await this.settingsChanged(settings);
  }

  async settingsChanged(settings: Pick<Settings, 'auto_follow'>) {
    if (settings.auto_follow && this.autoFollowIntervalHandle == null) {
      this.autoFollowIntervalHandle = setInterval(
        this.followPlayers.bind(this),
        ms('1 hour')
      );
    } else if (!settings.auto_follow && this.autoFollowIntervalHandle != null) {
      clearInterval(this.autoFollowIntervalHandle);
      this.autoFollowIntervalHandle = undefined;
    }
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

    for (const { did, handle } of playersToFollow) {
      try {
        console.log(`Following ${handle} (${did})`);
        const agent = await this.santaAgent();
        const { uri } = await agent.follow(did);

        newrelic.recordCustomEvent('SecretSantaSantaAutoFollow', {
          playerDid: did,
          playerHandle: handle,
          followUri: uri,
          santaDid: this.santaAccountDid,
        });
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

  async getPlayer(player_did: string): Promise<Player | undefined> {
    const dbPlayer = await this.db
      .selectFrom('player')
      .selectAll()
      .where('did', '=', player_did)
      .executeTakeFirst();

    return dbPlayer == null ? undefined : dbPlayerToPlayer(dbPlayer);
  }

  async refreshFollowing(
    player_did: string
  ): Promise<SelectedPlayer | undefined> {
    const { relationships } = await fetchRelationships(
      this.santaAccountDid,
      player_did
    );
    const relationship = AppBskyGraphDefs.isRelationship(relationships[0])
      ? relationships[0]
      : undefined;

    const dbPlayer = await this.db
      .updateTable('player')
      .set({
        following_santa_uri: relationship?.followedBy ?? null,
        santa_following_uri: relationship?.following ?? null,
      })
      .where('did', '=', player_did)
      .returningAll()
      .executeTakeFirst();

    return dbPlayer;
  }

  async createPlayer(
    player_did: string,
    attributes: Partial<InsertObject<DatabaseSchema, 'player'>> = {}
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

    const player: InsertObject<DatabaseSchema, 'player'> = {
      did: player_did,
      handle: profile.handle,
      avatar_url: profile.avatar,
      profile_complete: 0,
      signup_complete: 0,
      following_santa_uri: relationship?.followedBy ?? null,
      santa_following_uri: relationship?.following ?? null,
      address_review_required: null,
      max_giftees: 0,
      opted_out: null,
      booted: null,
      ...attributes,
    };

    const result = await this.db
      .insertInto('player')
      .values(player)
      .onConflict((oc) =>
        oc.column('did').doUpdateSet((eb) => ({
          handle: eb.ref('excluded.handle'),
          following_santa_uri: eb.ref('excluded.following_santa_uri'),
          santa_following_uri: eb.ref('excluded.santa_following_uri'),
        }))
      )
      .returningAll()
      .execute();

    this.listeners.forEach((listener) => listener());

    const savedPlayer = result[0];
    if (savedPlayer == null) {
      throw new Error('No player returned from save');
    }

    return dbPlayerToPlayer(savedPlayer);
  }

  async patchPlayer(
    player_did: string,
    updates: Partial<
      Omit<
        Player,
        | 'id'
        | 'did'
        | 'following_santa'
        | 'profile_complete'
        | 'signup_complete'
      >
    >
  ): Promise<SelectedPlayer | undefined> {
    const { address_review_required, opted_out, ...rest } = updates;

    const now = new Date().toISOString();
    const dbPlayer = await this.db
      .updateTable('player')
      .set({
        ...rest,
        ...(address_review_required == null
          ? undefined
          : { address_review_required: address_review_required ? now : null }),
        ...(opted_out == null
          ? undefined
          : { opted_out: opted_out ? now : null }),
      })
      .where('did', '=', player_did)
      .returningAll()
      .executeTakeFirst();

    return dbPlayer;
  }

  async deletePlayer(player_did: string): Promise<void> {
    await this.db.deleteFrom('player').where('did', '=', player_did).execute();
    this.listeners.forEach((listener) => listener());
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
    const author = getAuthorFromUri(followUri);
    if (author === this.santaAccountDid) {
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
      .select(['handle', 'signup_complete'])
      .where('did', '=', playerDid)
      .executeTakeFirst();
    if (record != null && newHandle !== record.handle) {
      newrelic.recordCustomEvent('SecretSantaHandleChange', {
        playerDid,
        oldHandle: record.handle,
        newHandle,
      });
      await this.handleChangedWebhook({
        player_did: playerDid,
        old_handle: record.handle,
        new_handle: newHandle,
      });
      const matches = await queryFullMatch(this.db)
        .where('match.match_status', '<>', 'draft')
        .select('santa.did as santa_did')
        .execute();
      for (const match of matches) {
        const deets = {
          dmType: 'change-handle',
          recipientDid: match.santa_did,
          recordId: match.match_id,
          recipientHandle: match.santa_handle,
        };
        try {
          await this.dmSender.sendDm({
            ...deets,
            rawMessage: `👋 Santa here,\n\nJust a quick note to let you know your Giftee has changed their Twitter handle from @${record.handle} to @${newHandle}. Still the same person though.\n\nGood thing I checked that list twice! [Sent by 🤖]`,
            markSent: () => Promise.resolve(undefined),
            markError: (errorText) => Promise.reject(new Error(errorText)),
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
          console.error('Unable to send handle change dm', e);
          newrelic.noticeError(e, deets);
        }
      }
      await this.db
        .updateTable('player')
        .set({ handle: newHandle })
        .where('did', '=', playerDid)
        .execute();
    }
  }

  addListener(listener: PlayersChangedListener) {
    this.listeners.push(listener);
  }
}
