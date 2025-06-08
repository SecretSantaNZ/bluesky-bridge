import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as dateUtils from '../../../../lib/dates.js';
import { queryTracking } from '../../../../lib/database/tracking.js';

export const matchTracking: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/match-tracking',
    {
      schema: {
        querystring: z.object({
          match_id: z.coerce.number(),
        }),
      },
    },
    async function (request, reply) {
      const tracking = await queryTracking(this.blueskyBridge.db)
        .where('tracking.match', '=', request.query.match_id)
        .orderBy('shipped_date', 'asc')
        .execute();

      return reply.view('admin/fragments/match-tracking.ejs', {
        ...dateUtils,
        tracking,
      });
    }
  );
};
