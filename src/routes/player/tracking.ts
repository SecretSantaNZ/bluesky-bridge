import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  queryTracking,
  queryTrackingWithMatch,
} from '../../lib/database/index.js';
import * as dateUtils from '../../lib/dates.js';

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
      await queryTrackingWithMatch(db)
        .where('match.giftee', '=', player.id)
        .where('tracking.id', '=', request.params.tracking_id)
        .executeTakeFirstOrThrow();

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

      const tracking = await queryTracking(db)
        .where('tracking.id', '=', request.params.tracking_id)
        .executeTakeFirstOrThrow();

      return reply.view('/partials/tracking.ejs', {
        ...dateUtils,
        tracking,
        show_tracking_giftee: false,
        show_tracking_actions: true,
      });
    }
  );
};
