import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';
import { InternalServerError } from 'http-errors-enhanced';
import { queryFullMatch } from '../../../../lib/database/match.js';
import { queryTracking } from '../../../../lib/database/tracking.js';

export const tracking: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/:match_id/tracking',
    {
      schema: {
        params: z.object({
          match_id: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { db } = this.blueskyBridge;

      const [match, carriers, trackings] = await Promise.all([
        queryFullMatch(db)
          .where('match.id', '=', request.params.match_id)
          .executeTakeFirstOrThrow(),
        db.selectFrom('carrier').selectAll().orderBy('id', 'asc').execute(),
        queryTracking(db)
          .where('match', '=', request.params.match_id)
          .execute(),
      ]);

      const trackingRecord = {
        tracking_number: '',
        carrier_id: carriers[0]?.id,
        giftwrap_status: 0,
      };

      return reply.view('admin/match/tracking', {
        match,
        carriers,
        trackingRecord,
        trackings,
        matchEvents: [{ updated: match }],
      });
    }
  );

  app.post(
    '/:match_id/tracking',
    {
      schema: {
        params: z.object({
          match_id: z.coerce.number(),
        }),
        body: z.object({
          shipped_date: z.string().date(),
          carrier: z.coerce.number(),
          tracking_number: z.string(),
          giftwrap_status: z.coerce.number().min(0).max(1),
        }),
      },
    },
    async function handler(request, reply) {
      const match_id = request.params.match_id;
      const { shipped_date, carrier, tracking_number, giftwrap_status } =
        request.body;
      const did = request.tokenSubject as string;
      const { db, playerService } = this.blueskyBridge;
      const player = await playerService.getPlayer(did);
      if (player == null) {
        throw new InternalServerError(`Player not found ${did}`);
      }
      await Promise.all([
        db
          .selectFrom('match')
          .selectAll()
          .where('id', '=', match_id)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('carrier')
          .selectAll()
          .where('id', '=', carrier)
          .executeTakeFirstOrThrow(),
      ]);
      await db
        .insertInto('tracking')
        .values({
          carrier,
          shipped_date,
          tracking_number,
          giftwrap_status,
          missing: null,
          match: match_id,
          tracking_status: 'queued',
          created_at: new Date().toISOString(),
          created_by: did,
        })
        .executeTakeFirstOrThrow();

      return reply.redirect(`/admin/match/${match_id}/tracking`, 303);
    }
  );
};
