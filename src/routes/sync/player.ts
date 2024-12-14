import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const player: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/player/:player_did',
    {
      schema: {
        params: z.object({
          player_did: z.string(),
        }),
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

  // app.put(
  //   '/player/:player_did',
  //   {
  //     schema: {
  //       params: z.object({
  //         player_did: z.string(),
  //       }),
  //       body: z.object({
  //         registration_complete: z.boolean(),
  //       }),
  //     },
  //   },
  //   async function (request, reply) {
  //     const { player_did } = request.params;
  //     const { registration_complete } = request.body;
  //     const { playerService } = this.blueskyBridge;

  //     const player = await playerService.createPlayer(
  //       player_did,
  //       registration_complete
  //     );

  //     reply.send({
  //       player,
  //     });
  //   }
  // );

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
