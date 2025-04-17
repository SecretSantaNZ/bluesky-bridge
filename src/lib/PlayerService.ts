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
import { safeFetchWrap } from '@atproto-labs/fetch-node';
import wretch from 'wretch';
import FormDataAddon from 'wretch/addons/formData';

import type {
  DatabaseSchema,
  Player as DbPlayer,
  Settings,
} from './database/schema.js';
import ms from 'ms';
import type { InsertObject, SelectType } from 'kysely';
import type { DmSender } from './DmSender.js';
import { z } from 'zod';
import { addDays } from 'date-fns';
import type { ProfileViewDetailed } from '@atproto/api/dist/client/types/app/bsky/actor/defs.js';

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

type MastodonRelationshipDetails = Pick<
  SelectedPlayer,
  | 'mastodon_id'
  | 'mastodon_followed_by_santa'
  | 'mastodon_following_santa'
  | 'mastodon_follow_last_checked'
>;

const w = wretch()
  .polyfills({
    fetch: safeFetchWrap(),
  })
  .addon(FormDataAddon)
  .options({
    redirect: 'error',
  });

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
    player_handle: string;
    following_santa: boolean;
  }>;
  private readonly handleChangedWebhook: WebhookNotifier<{
    player_did: string;
    old_handle: string;
    new_handle: string;
  }>;
  private readonly optedOutWebhook: WebhookNotifier<{
    player_did: string;
    player_handle: string;
    giftee_count: number;
    giftee_for_count: number;
  }>;
  private autoFollowIntervalHandle?: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: Database,
    private readonly santaAgent: () => Promise<Agent>,
    private readonly santaAccountDid: string,
    public readonly dmSender: DmSender,
    public readonly ensureElfDids: ReadonlySet<string>,
    public readonly santaMastodonHandle: string,
    public readonly santaMastodonHost: string
  ) {
    this.followingChangedWebhook = buildWebhookNotifier(
      process.env.FOLLOWING_CHANGED_WEBHOOK,
      'following changed'
    );
    this.handleChangedWebhook = buildWebhookNotifier(
      process.env.HANDLE_CHANGED_WEBHOOK,
      'handle changed'
    );
    this.optedOutWebhook = buildWebhookNotifier(
      process.env.OPTED_OUT_WEBHOOK,
      'opted out'
    );

    this.init();
  }

  private async init() {
    const settings = await this.db
      .selectFrom('settings')
      .select('auto_follow')
      .executeTakeFirstOrThrow();
    await this.settingsChanged(settings);

    setInterval(this.refreshMastodonFollowing.bind(this), ms('60m'));
    setInterval(this.refreshPostCounts.bind(this), ms('60m'));
  }

  async settingsChanged(settings: Pick<Settings, 'auto_follow'>) {
    if (settings.auto_follow && this.autoFollowIntervalHandle == null) {
      this.autoFollowIntervalHandle = setInterval(
        this.followPlayers.bind(this),
        ms('60m')
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
          followType: 'bluesky',
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

    const [mastodonPlayersToFollow, santaToken] = await Promise.all([
      this.db
        .selectFrom('player')
        .select(['did', 'handle', 'mastodon_account', 'mastodon_id'])
        .where('player_type', '=', 'mastodon')
        .where('mastodon_followed_by_santa', '=', 0)
        .where('signup_complete', '=', 1)
        .limit(4)
        .execute(),
      this.getSantaMastodonToken(),
    ]);
    console.log(
      `Found ${mastodonPlayersToFollow.length} mastodon players to follow`
    );
    if (santaToken == null) {
      console.log('No santa mastodon token, skipping follows');
    } else {
      for (const {
        did,
        mastodon_account,
        mastodon_id,
      } of mastodonPlayersToFollow) {
        try {
          console.log(`Following @${mastodon_account} (${did})`);
          await w
            .auth(`Bearer ${santaToken.token}`)
            .url(
              new URL(
                `/api/v1/accounts/${mastodon_id}/follow`,
                `https://${this.santaMastodonHost}`
              ).href
            )
            .post()
            .json();

          newrelic.recordCustomEvent('SecretSantaSantaAutoFollow', {
            playerDid: did,
            playerHandle: mastodon_account ?? '',
            followType: 'mastodon',
          });
          await this.db
            .updateTable('player')
            .set({ mastodon_followed_by_santa: 1 })
            .where('did', '=', did)
            .execute();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          console.error(error);
          console.error(
            `Error following @${mastodon_account} (${did}): ${error.message}`
          );
        }
      }
    }
  }

  private async refreshMastodonFollowing() {
    const playersToCheck = await this.db
      .selectFrom('player')
      .select(['did', 'mastodon_id'])
      .where('player_type', '=', 'mastodon')
      .where('mastodon_following_santa', '=', 0)
      .where('deactivated', 'is', null)
      .orderBy('mastodon_follow_last_checked asc')
      .limit(25)
      .execute();

    const relationships = await this.queryMastodonRelationships(
      ...playersToCheck.map((player) => player.mastodon_id as string)
    );

    for (const player of playersToCheck) {
      const relationship = relationships[player.mastodon_id as string] ?? {
        mastodon_id: player.mastodon_id,
        mastodon_follow_last_checked: new Date().toISOString(),
        mastodon_followed_by_santa: 0,
        mastodon_following_santa: 0,
      };
      await this.db
        .updateTable('player')
        .set(relationship)
        .where('did', '=', player.did)
        .execute();
    }
  }

  private async refreshPostCounts() {
    console.log('Refreshing Post Counts');
    const now = new Date();
    const nowIso = now.toISOString();
    const checkPlayersBefore = addDays(now, -1).toISOString();
    const playersToCheckResult = await this.db
      .selectFrom('player')
      .select('did')
      .where('last_checked_post_count', '<=', checkPlayersBefore)
      .orderBy('last_checked_post_count asc')
      .limit(25)
      .execute();
    const playersToCheck = playersToCheckResult
      .map((player) => player.did)
      // Hack, I have a lot of invalid test dids so filter those out
      .filter(
        (did) => did.startsWith('did:web:') || did.startsWith('did:plc:')
      );

    console.log(
      `Checking ${playersToCheck.length} players post counts before ${checkPlayersBefore}`
    );
    if (playersToCheck.length === 0) return;

    const profilesResult = await unauthenticatedAgent.getProfiles({
      actors: playersToCheck,
    });
    const profiles: Record<string, ProfileViewDetailed> = {};
    profilesResult.data.profiles.forEach((profile) => {
      profiles[profile.did] = profile;
    });
    for (const did of playersToCheck) {
      const profile = profiles[did];
      await this.db
        .updateTable('player')
        .set((eb) => ({
          post_count: profile?.postsCount ?? 0,
          post_count_since_signup: eb
            .selectFrom('post')
            .select(({ fn }) => fn.countAll<number>().as('cnt'))
            .where('post.author', '=', did),
          last_checked_post_count: nowIso,
        }))
        .where('did', '=', did)
        .execute();
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
    const { player_type, mastodon_account } = await this.db
      .selectFrom('player')
      .select(['player_type', 'mastodon_account'])
      .where('did', '=', player_did)
      .executeTakeFirstOrThrow();
    const [{ relationships }, mastodonFollowing] = await Promise.all([
      fetchRelationships(this.santaAccountDid, player_did),
      player_type === 'mastodon'
        ? this.lookupMastodonFollowing(mastodon_account as string)
        : undefined,
    ]);
    const relationship = AppBskyGraphDefs.isRelationship(relationships[0])
      ? relationships[0]
      : undefined;

    const dbPlayer = await this.db
      .updateTable('player')
      .set({
        following_santa_uri: relationship?.followedBy ?? null,
        santa_following_uri: relationship?.following ?? null,
        ...mastodonFollowing,
      })
      .where('did', '=', player_did)
      .returningAll()
      .executeTakeFirst();

    return dbPlayer;
  }

  async retryPlayerDms(player_did: string) {
    const { data: profile } = await unauthenticatedAgent.getProfile({
      actor: player_did,
    });
    const allowIncoming = profile.associated?.chat?.allowIncoming ?? 'none';

    this.db
      .updateTable('player')
      .set({
        player_dm_status:
          allowIncoming === 'none' ? 'error: DMs Disabled' : 'queued',
      })
      .where('did', '=', player_did)
      .executeTakeFirst();
  }

  async createPlayer(
    player_did: string,
    player_type: 'bluesky' | 'mastodon',
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

    const handle = profile.handle;
    const following_santa_uri = relationship?.followedBy ?? null;
    const allowIncoming = profile.associated?.chat?.allowIncoming ?? 'none';
    const player: InsertObject<DatabaseSchema, 'player'> = {
      did: player_did,
      handle,
      avatar_url: profile.avatar,
      profile_complete: 0,
      signup_complete: 0,
      following_santa_uri,
      santa_following_uri: relationship?.following ?? null,
      address_review_required: null,
      max_giftees: 0,
      opted_out: null,
      booted: null,
      admin: this.ensureElfDids.has(player_did) ? 1 : 0,
      player_type,
      player_dm_status:
        allowIncoming === 'none' ? 'error: DMs Disabled' : 'queued',
      ...attributes,
      post_count: profile.postsCount ?? 0,
      post_count_since_signup: 0,
      last_checked_post_count: new Date().toISOString(),
    };

    const result = await this.db
      .insertInto('player')
      .values(player)
      .onConflict((oc) =>
        oc.column('did').doUpdateSet((eb) => ({
          handle: eb.ref('excluded.handle'),
          avatar_url: eb.ref('excluded.avatar_url'),
          following_santa_uri: eb.ref('excluded.following_santa_uri'),
          santa_following_uri: eb.ref('excluded.santa_following_uri'),
          player_type: eb.ref('excluded.player_type'),
        }))
      )
      .returningAll()
      .execute();

    this.listeners.forEach((listener) => listener());

    const savedPlayer = result[0];
    if (savedPlayer == null) {
      throw new Error('No player returned from save');
    }

    if (savedPlayer.handle !== handle) {
      await this.updateHandle(player_did, handle);
    }
    if (
      savedPlayer.following_santa_uri != null &&
      following_santa_uri == null
    ) {
      await this.removeFollow(savedPlayer.following_santa_uri);
    } else if (
      following_santa_uri != null &&
      savedPlayer.following_santa_uri !== following_santa_uri
    ) {
      await this.recordFollow(
        player_did,
        this.santaAccountDid,
        following_santa_uri
      );
    }

    return dbPlayerToPlayer({
      ...savedPlayer,
      handle,
      following_santa_uri,
    });
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
      await this.db
        .updateTable('player')
        .set({
          following_santa_uri: followUri,
        })
        .where('did', '=', authorDid)
        .executeTakeFirst();
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
      if (
        deleteFollowResult != null &&
        (deleteFollowResult.giftee_count > 0 ||
          deleteFollowResult.giftee_for_count > 0)
      ) {
        await this.followingChangedWebhook({
          player_did: deleteFollowResult.did,
          player_handle: deleteFollowResult.handle,
          following_santa: false,
        });
      }
    }
  }

  async optOut(playerDid: string) {
    const record = await this.db
      .updateTable('player')
      .set({ opted_out: new Date().toISOString() })
      .where('did', '=', playerDid)
      .returningAll()
      .executeTakeFirst();

    if (record == null) return undefined;

    newrelic.recordCustomEvent('SecretSantaOptedOut', {
      playerDid,
      playerHandle: record.handle,
      gifteeCount: record.giftee_count,
      gifteeForCount: record.giftee_for_count,
    });
    if (record.giftee_count > 0 || record.giftee_for_count > 0) {
      await this.optedOutWebhook({
        player_did: record.did,
        player_handle: record.handle,
        giftee_count: record.giftee_count,
        giftee_for_count: record.giftee_for_count,
      });
    }

    return dbPlayerToPlayer(record);
  }

  async updateHandle(playerDid: string, newHandle: string) {
    const record = await this.db
      .selectFrom('player')
      .select([
        'id',
        'handle',
        'signup_complete',
        'giftee_count',
        'giftee_for_count',
      ])
      .where('did', '=', playerDid)
      .executeTakeFirst();
    if (record != null && newHandle !== record.handle) {
      newrelic.recordCustomEvent('SecretSantaHandleChange', {
        playerDid,
        oldHandle: record.handle,
        newHandle,
        gifteeCount: record.giftee_count,
        gifteeForCount: record.giftee_for_count,
      });
      if (record.giftee_count > 0 && record.giftee_for_count > 0) {
        await this.handleChangedWebhook({
          player_did: playerDid,
          old_handle: record.handle,
          new_handle: newHandle,
        });
      }
      const matches = await queryFullMatch(this.db)
        .where('match.match_status', '<>', 'draft')
        .select('santa.did as santa_did')
        .select('santa.player_type as santa_player_type')
        .select('santa.mastodon_account as santa_mastodon_account')
        .where('match.giftee', '=', record.id)
        .execute();
      for (const match of matches) {
        const deets = {
          dmType: 'change-handle',
          recipientDid: match.santa_did,
          playerType: match.santa_player_type,
          recipientMastodonHandle: match.santa_mastodon_account ?? '',
          recordId: match.match_id,
          recipientHandle: match.santa_handle,
        };
        if (deets.recipientDid === this.santaAccountDid) {
          continue;
        }

        try {
          await this.dmSender.sendDm({
            ...deets,
            rawMessage: `👋 Santa here,\n\nJust a quick note to let you know your Giftee has changed their Twitter handle from @${record.handle} to @${newHandle}. Still the same person though.\n\nGood thing I checked that list twice!`,
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

  async resetEverything() {
    await this.db.deleteFrom('tracking').execute();
    await this.db.deleteFrom('nudge').execute();
    await this.db.deleteFrom('match').execute();
    await this.db.deleteFrom('player').execute();
  }

  addListener(listener: PlayersChangedListener) {
    this.listeners.push(listener);
  }

  async getSantaMastodonToken() {
    const santaToken = await this.db
      .selectFrom('mastodon_token')
      .selectAll()
      .where('account', '=', this.santaMastodonHandle)
      .executeTakeFirst();

    return santaToken;
  }

  async queryMastodonRelationships(
    ...mastodonIds: Array<string>
  ): Promise<Record<string, MastodonRelationshipDetails>> {
    const santaToken = await this.getSantaMastodonToken();
    if (santaToken == null) {
      console.error('No santa mastodon token, skipping relationships check');
      return {};
    }

    const relationshipsUrl = new URL(
      '/api/v1/accounts/relationships',
      `https://${this.santaMastodonHost}`
    );
    for (const mastodon_id of mastodonIds) {
      relationshipsUrl.searchParams.append('id[]', mastodon_id);
    }

    const relationships = z
      .array(
        z.object({
          id: z.string(),
          following: z.boolean(),
          followed_by: z.boolean(),
          requested: z.boolean(),
        })
      )
      .parse(
        await w
          .headers({
            Authorization: `Bearer ${santaToken.token}`,
          })
          .get(relationshipsUrl.href)
          .json()
      );

    const now = new Date().toISOString();
    return Object.fromEntries(
      relationships
        .map(
          (relationship): MastodonRelationshipDetails => ({
            mastodon_id: relationship.id,
            mastodon_following_santa: relationship.followed_by ? 1 : 0,
            mastodon_followed_by_santa: relationship.following ? 1 : 0,
            mastodon_follow_last_checked: now,
          })
        )
        .map((relationship) => [relationship.mastodon_id, relationship])
    );
  }

  async lookupMastodonFollowing(
    mastodon_account: string
  ): Promise<MastodonRelationshipDetails> {
    if (mastodon_account === this.santaMastodonHandle) {
      const santaToken = await this.getSantaMastodonToken();
      if (santaToken == null) {
        throw new Error('No santa mastodon token');
      }
      return {
        mastodon_id: santaToken.mastodon_id,
        mastodon_following_santa: 1,
        mastodon_followed_by_santa: 1,
        mastodon_follow_last_checked: '9999-12-30T23:59:59.999Z',
      };
    } else {
      const lookupUrl = new URL(
        '/api/v1/accounts/lookup',
        `https://${this.santaMastodonHost}`
      );
      lookupUrl.searchParams.set('acct', mastodon_account);
      const { id: mastodon_id } = z
        .object({ id: z.string() })
        .parse(await w.get(lookupUrl.href).json());

      const relationships = await this.queryMastodonRelationships(mastodon_id);
      const relationship = relationships[mastodon_id];

      return (
        relationship ?? {
          mastodon_id,
          mastodon_following_santa: 0,
          mastodon_followed_by_santa: 0,
          mastodon_follow_last_checked: new Date().toISOString(),
        }
      );
    }
  }
}
