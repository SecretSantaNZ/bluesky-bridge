import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { baseAdminPlayerQuery } from '../manage-players.js';
import { NotFoundError } from 'http-errors-enhanced';
import { getLocation } from '../../../../lib/googlePlaces.js';

export const address: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/address',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
      },
    },
    async function (request, reply) {
      const { db, playerService } = this.blueskyBridge;
      const [player, adminPlayer] = await Promise.all([
        playerService.getPlayerById(request.params.player_id),
        baseAdminPlayerQuery(db)
          .where('player.id', '=', request.params.player_id)
          .executeTakeFirstOrThrow(),
      ]);

      if (player == null) {
        throw new NotFoundError();
      }

      return reply.view('admin/player/address', {
        player,
        player_display_handle:
          player.player_type === 'mastodon'
            ? player.mastodon_account
            : player.handle,
        playerEvents: [
          {
            updated: adminPlayer,
          },
        ],
      });
    }
  );

  app.post(
    '/address',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
        body: z.object({
          address: z.string(),
          delivery_instructions: z.string(),
        }),
      },
    },
    async function handler(request, reply) {
      const { playerService } = app.blueskyBridge;
      const player = await playerService.getPlayerById(
        request.params.player_id
      );
      if (player == null) {
        throw new NotFoundError();
      }
      const location = await getLocation(player.handle, request.body.address);
      await playerService.patchPlayer(player.did, {
        ...request.body,
        address_location: location ? JSON.stringify(location) : null,
        address_review_required: false,
      });

      return reply.redirect(`/admin/player/${player.id}/address`, 303);
    }
  );
};
