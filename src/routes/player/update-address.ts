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
      const did = request.tokenSubject as string;
      const { playerService } = app.blueskyBridge;
      const player = await playerService.getPlayer(did);
      if (player == null) {
        throw new NotFoundError();
      }
      if (player.locked_giftee_for_count) {
        throw new BadRequestError('Address has been sent');
      }
      await playerService.patchPlayer(did, {
        ...request.body,
        address_review_required:
          address == null ? undefined : !address.match(/new zealand|aotearoa/i),
      });

      return reply.code(204).header('HX-Refresh', 'true').send();
    }
  );
};
