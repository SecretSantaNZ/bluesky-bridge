import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createPlayer, deletePlayer } from '../../lib/player.js';

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

      const player = await createPlayer(db, player_did);

      reply.send({
        player,
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

      await deletePlayer(db, player_did);

      reply.send({ ok: true });
    }
  );
};
