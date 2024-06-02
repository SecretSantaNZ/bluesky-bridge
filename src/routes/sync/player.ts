import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getSantaBskyAgent, unauthenticatedAgent } from '../../bluesky.js';
import { AppBskyGraphDefs } from '@atproto/api';
import type { Player } from '../../lib/database/schema.js';

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

      const [
        { data: profile },
        {
          data: { relationships },
        },
      ] = await Promise.all([
        unauthenticatedAgent.getProfile({
          actor: player_did,
        }),
        unauthenticatedAgent.app.bsky.graph.getRelationships({
          actor: santaAgent.session?.did as string,
          others: [player_did],
        }),
      ]);
      const following_santa_uri = AppBskyGraphDefs.isRelationship(
        relationships[0]
      )
        ? relationships[0].followedBy
        : undefined;

      const player: Player = {
        did: player_did,
        handle: profile.handle,
        following_santa_uri: following_santa_uri ?? null,
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
