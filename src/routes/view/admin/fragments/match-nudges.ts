import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as dateUtils from '../../../../lib/dates.js';

export const matchNudges: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/match-nudges',
    {
      schema: {
        querystring: z.object({
          match_id: z.coerce.number(),
        }),
      },
    },
    async function (request, reply) {
      const nudges = await this.blueskyBridge.db
        .selectFrom('nudge')
        .innerJoin('nudge_type', 'nudge_type.id', 'nudge.nudge_type')
        .select([
          'nudge_type.name as nudge_type',
          'nudge.created_at',
          'nudge.id as nudge_id',
        ])
        .where('match', '=', request.query.match_id)
        .orderBy('nudge.id desc')
        .execute();

      return reply.view('admin/fragments/match-nudges.ejs', {
        ...dateUtils,
        nudges,
      });
    }
  );
};
