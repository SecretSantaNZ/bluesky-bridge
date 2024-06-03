import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

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
      const { playerService } = this.blueskyBridge;

      const player = await playerService.createPlayer(player_did);

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
      const { playerService } = this.blueskyBridge;

      await playerService.deletePlayer(player_did);

      reply.send({ ok: true });
    }
  );
};
