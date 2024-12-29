import type { FastifyPluginAsync } from 'fastify';
import { BadRequestError, NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const updateAddress: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/update-address',
    {
      schema: {
        body: z.object({
          address: z.string(),
          delivery_instructions: z.string(),
        }),
      },
    },
    async function handler(request, reply) {
      const { address } = request.body;
      const playerDid = request.playerDid as string;
      const { playerService, db } = app.blueskyBridge;
      const player = await playerService.getPlayer(playerDid);
      if (player == null) {
        throw new NotFoundError();
      }
      if (!request.tokenData?.admin && player.locked_giftee_for_count) {
        throw new BadRequestError('Address has been sent');
      }
      await playerService.patchPlayer(playerDid, {
        ...request.body,
        address_review_required:
          address == null ? undefined : !address.match(/new zealand|aotearoa/i),
      });

      if (request.adminMode) {
        const updatedPlayer = await db
          .selectFrom('player')
          .selectAll()
          .where('did', '=', playerDid)
          .executeTakeFirst();
        reply.header(
          'HX-Trigger',
          JSON.stringify({
            'ss-player-updated': updatedPlayer,
            'ss-close-modal': true,
          })
        );
      } else {
        reply.header('HX-Refresh', 'true');
      }
      return reply.code(204).send();
    }
  );
};
