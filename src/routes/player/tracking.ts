import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { queryTrackingWithMatch } from '../../lib/database/index.js';

export const tracking: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/tracking/:tracking_id/:action',
    {
      schema: {
        params: z.object({
          tracking_id: z.coerce.number(),
          action: z.enum(['missing', 'arrived']),
        }),
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const did = request.tokenSubject as string;
      const { db, playerService } = app.blueskyBridge;
      const player = await playerService.getPlayer(did);
      if (player == null) {
        throw new NotFoundError();
      }
      if (!request.tokenData?.admin) {
        // Only allow non elves to update tracking for their own gifts
        await queryTrackingWithMatch(db)
          .where('match.giftee', '=', player.id)
          .where('tracking.id', '=', request.params.tracking_id)
          .executeTakeFirstOrThrow();
      }

      await db
        .updateTable('tracking')
        .set({
          missing:
            request.params.action === 'missing'
              ? new Date().toISOString()
              : null,
        })
        .where('id', '=', request.params.tracking_id)
        .execute();

      return reply.redirect('/', 303);
    }
  );
};
