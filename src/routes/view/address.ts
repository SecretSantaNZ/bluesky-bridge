import type { FastifyPluginAsync } from 'fastify';
import { BadRequestError, NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getLocation } from '../../lib/googlePlaces.js';
import type { Player } from '../../lib/PlayerService.js';

/** Whether an address needs manual review: only NZ/Aotearoa addresses pass
 *  the automated check. */
export function addressReviewRequired(
  address: string | null | undefined
): boolean | undefined {
  return address == null ? undefined : !/new zealand|aotearoa/i.test(address);
}

/** Throws once the player's address has been shared with their santa and
 *  can no longer be changed. */
export function ensureAddressEditable(
  player: Pick<Player, 'locked_giftee_for_count'>
) {
  if (player.locked_giftee_for_count) {
    throw new BadRequestError('Address has been sent');
  }
}

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
      const playerDid = request.tokenSubject as string;
      const { playerService } = app.blueskyBridge;
      const player = await playerService.getPlayer(playerDid);
      if (player == null) {
        throw new NotFoundError();
      }
      ensureAddressEditable(player);
      const location = await getLocation(player.handle, request.body.address);
      await playerService.patchPlayer(playerDid, {
        ...request.body,
        address_location: location ? JSON.stringify(location) : null,
        address_review_required: addressReviewRequired(request.body.address),
      });

      return reply.redirect('/', 303);
    }
  );
};
