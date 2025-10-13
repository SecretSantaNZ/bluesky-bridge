import type { FastifyPluginAsync } from 'fastify';
import { BadRequestError, NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getLocation } from '../../lib/googlePlaces.js';

export const address: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get('/address', function (request, reply) {
    return reply.view('player/address');
  });

  app.post(
    '/address',
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
      const playerDid = request.tokenSubject as string;
      const { playerService } = app.blueskyBridge;
      const player = await playerService.getPlayer(playerDid);
      if (player == null) {
        throw new NotFoundError();
      }
      if (player.locked_giftee_for_count) {
        throw new BadRequestError('Address has been sent');
      }
      const location = await getLocation(player.handle, request.body.address);
      await playerService.patchPlayer(playerDid, {
        ...request.body,
        address_location: location ? JSON.stringify(location) : null,
        address_review_required:
          address == null ? undefined : !address.match(/new zealand|aotearoa/i),
      });

      return reply.redirect('/', 303);
    }
  );
};
