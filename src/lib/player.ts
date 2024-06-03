import {
  AppBskyGraphDefs,
  type AppBskyGraphGetRelationships,
} from '@atproto/api';
import { getSantaBskyAgent, unauthenticatedAgent } from '../bluesky.js';
import type { Database } from './database/index.js';
import fetch from 'node-fetch';
import { InternalServerError } from 'http-errors-enhanced';

import type { Player as DbPlayer } from './database/schema.js';

export type Player = Omit<
  DbPlayer,
  'following_santa_uri' | 'santa_following_uri'
> & { following_santa: boolean };

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

export const createPlayer = async (
  db: Database,
  player_did: string
): Promise<Player> => {
  const santaAgent = await getSantaBskyAgent();
  const santaDid = santaAgent.session?.did as string;

  const [{ data: profile }, { relationships }] = await Promise.all([
    unauthenticatedAgent.getProfile({
      actor: player_did,
    }),
    fetchRelationships(santaDid, player_did),
  ]);
  const relationship = AppBskyGraphDefs.isRelationship(relationships[0])
    ? relationships[0]
    : undefined;

  const player: DbPlayer = {
    did: player_did,
    handle: profile.handle,
    following_santa_uri: relationship?.followedBy ?? null,
    santa_following_uri: relationship?.following ?? null,
  };

  await db
    .insertInto('player')
    .values(player)
    .onConflict((oc) => oc.column('did').doUpdateSet(player))
    .execute();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { following_santa_uri, santa_following_uri, ...rest } = player;
  return { ...rest, following_santa: following_santa_uri != null };
};

export const deletePlayer = async (
  db: Database,
  player_did: string
): Promise<void> => {
  await db.deleteFrom('player').where('did', '=', player_did).execute();
};

const getAuthorFromtUri = (postUri: string | undefined) => {
  if (postUri == null) return undefined;
  const [, , repo] = postUri.split('/');
  return repo;
};

const notifyFollowingChanged = async (
  player_did: string,
  following_santa: boolean
) => {
  const followingChangedWebhook = process.env.FOLLOWING_CHANGED_WEBHOOK;

  if (followingChangedWebhook) {
    const result = await fetch(followingChangedWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        player_did,
        following_santa: true,
      }),
    });
    await result.text();
    console.log(`Notify Make ${player_did} Following: ${following_santa}`);
  } else {
    console.log(
      `(SKIPPED) Notify Make ${player_did} Following: ${following_santa}`
    );
  }
};

export const recordFollow = async (
  db: Database,
  authorDid: string,
  followedDid: string,
  followUri: string
) => {
  const santaAgent = await getSantaBskyAgent();
  const santaAccountDid = santaAgent.session?.did;
  if (authorDid === santaAccountDid) {
    await db
      .updateTable('player')
      .set({
        santa_following_uri: followUri,
      })
      .where('did', '=', followedDid)
      .executeTakeFirst();
  } else if (followedDid === santaAccountDid) {
    const updatedPlayer = await db
      .updateTable('player')
      .set({
        following_santa_uri: followUri,
      })
      .where('did', '=', authorDid)
      .returningAll()
      .executeTakeFirst();
    if (updatedPlayer != null) {
      await notifyFollowingChanged(updatedPlayer.did, true);
    }
  }
};

export const removeFollow = async (db: Database, followUri: string) => {
  const santaAgent = await getSantaBskyAgent();
  const santaAccountDid = santaAgent.session?.did;
  const author = getAuthorFromtUri(followUri);
  if (author === santaAccountDid) {
    await db
      .updateTable('player')
      .set({
        santa_following_uri: null,
      })
      .where('santa_following_uri', '=', followUri)
      .executeTakeFirst();
  } else {
    const deleteFollowResult = await db
      .updateTable('player')
      .set({
        following_santa_uri: null,
      })
      .where('following_santa_uri', '=', followUri)
      .returningAll()
      .executeTakeFirst();
    if (deleteFollowResult != null) {
      await notifyFollowingChanged(deleteFollowResult.did, false);
    }
  }
};

export const updateHandle = async (
  db: Database,
  playerDid: string,
  newHandle: string
) => {
  const record = await db
    .selectFrom('player')
    .select('handle')
    .where('did', '=', playerDid)
    .executeTakeFirst();
  if (record != null && newHandle !== record.handle) {
    const handleChangedWebhook = process.env.HANDLE_CHANGED_WEBHOOK;
    if (handleChangedWebhook) {
      const result = await fetch(handleChangedWebhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          player_did: playerDid,
          old_handle: record.handle,
          new_handle: newHandle,
        }),
      });
      await result.text();
      console.log(`Notify Make ${record.handle} => ${newHandle}`);
    } else {
      console.log(`(SKIPPED) Notify Make ${record.handle} => ${newHandle}`);
    }
    await db
      .updateTable('player')
      .set({ handle: newHandle })
      .where('did', '=', playerDid)
      .execute();
  }
};
