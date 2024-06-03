import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getSantaBskyAgent, unauthenticatedAgent } from '../../bluesky.js';
import { AppBskyGraphDefs, AppBskyGraphGetRelationships } from '@atproto/api';
import type { Player } from '../../lib/database/schema.js';
import { InternalServerError } from 'http-errors-enhanced';

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

export const player: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.put(
    '/player/:player_did',
    {
      schema: {
        params: z.object({ player_did: z.string() }),
      },
    },
    async function (request, reply) {
      const { player_did } = request.params;
      const { db } = this.blueskyBridge;

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

      const player: Player = {
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

      reply.send({
        player: {
          ...player,
          following_santa: player.following_santa_uri != null,
        },
      });
    }
  );

  app.delete(
    '/player/:player_did',
    {
      schema: {
        params: z.object({ player_did: z.string() }),
      },
    },
    async function (request, reply) {
      const { player_did } = request.params;
      const { db } = this.blueskyBridge;

      await db.deleteFrom('player').where('did', '=', player_did).execute();

      reply.send({ ok: true });
    }
  );
};
