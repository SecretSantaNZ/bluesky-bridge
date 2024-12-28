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
          player_did: z.string().optional(),
        }),
      },
    },
    async function handler(request, reply) {
      const { address, player_did, ...rest } = request.body;
      let did = request.tokenSubject as string;
      if (request.tokenData?.admin && player_did) {
        did = player_did;
      }
      const { playerService } = app.blueskyBridge;
      const player = await playerService.getPlayer(did);
      if (player == null) {
        throw new NotFoundError();
      }
      if (!request.tokenData?.admin && player.locked_giftee_for_count) {
        throw new BadRequestError('Address has been sent');
      }
      await playerService.patchPlayer(did, {
        ...rest,
        address,
        address_review_required:
          address == null ? undefined : !address.match(/new zealand|aotearoa/i),
      });

      return reply.code(204).header('HX-Refresh', 'true').send();
    }
  );
};
