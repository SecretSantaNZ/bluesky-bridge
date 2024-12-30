import type { FastifyPluginAsync } from 'fastify';
import { ForbiddenError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const newPlayer: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/new-player',
    {
      schema: {
        body: z.object({
          handle: z.string(),
          address: z.string(),
          delivery_instructions: z.string(),
        }),
      },
    },
    async function handler(request, reply) {
      if (!request.tokenData?.admin) {
        throw new ForbiddenError();
      }
      const { playerService, db, santaAgent } = app.blueskyBridge;
      const agent = await santaAgent();
      const resolveHandleResult = await agent.resolveHandle({
        handle: request.body.handle,
      });
      const playerDid = resolveHandleResult.data.did;
      await playerService.createPlayer(playerDid, {
        address: request.body.address || null,
        delivery_instructions: request.body.delivery_instructions || null,
        game_mode: 'Regular',
        max_giftees: 1,
      });

      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', playerDid)
        .executeTakeFirst();
      reply.header(
        'HX-Trigger',
        JSON.stringify({
          'ss-player-added': updatedPlayer,
          'ss-close-modal': true,
        })
      );
      return reply.code(204).send();
    }
  );
};
