import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';
import { queryFullMatch } from '../../lib/database/match.js';
import { formatDateIso } from '../../lib/dates.js';
import { BadRequestError, InternalServerError } from 'http-errors-enhanced';

export const tracking: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/match/:match_id/add-tracking',
    {
      schema: {
        params: z.object({
          match_id: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { db } = this.blueskyBridge;
      const did = request.tokenSubject as string;

      const [match, carriers] = await Promise.all([
        queryFullMatch(db)
          .where('match.id', '=', request.params.match_id)
          .where('santa.did', '=', did)
          .executeTakeFirstOrThrow(),
        db.selectFrom('carrier').selectAll().orderBy('id', 'asc').execute(),
      ]);

      const tracking = {
        shipped_date: formatDateIso(new Date()),
        tracking_number: '',
        carrier: carriers[0]?.id,
      };

      return reply.nunjucks('player/add-tracking', {
        match,
        carriers,
        tracking,
      });
    }
  );

  app.post(
    '/tracking',
    {
      schema: {
        body: z.object({
          match_id: z.coerce.number(),
          shipped_date: z.string().date(),
          carrier: z.coerce.number(),
          tracking_number: z.string(),
          giftwrap_status: z.coerce.number().min(0).max(1),
        }),
      },
    },
    async function handler(request, reply) {
      const {
        match_id,
        shipped_date,
        carrier,
        tracking_number,
        giftwrap_status,
      } = request.body;
      const did = request.tokenSubject as string;
      const { db, playerService } = this.blueskyBridge;
      const player = await playerService.getPlayer(did);
      if (player == null) {
        throw new InternalServerError(`Player not found ${did}`);
      }
      const [match, settings, { cnt: countTracking }] = await Promise.all([
        db
          .selectFrom('match')
          .selectAll()
          .where('santa', '=', player.id)
          .where('id', '=', match_id)
          .executeTakeFirstOrThrow(),
        db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
        db
          .selectFrom('tracking')
          .select(({ fn }) => [fn.countAll<number>().as('cnt')])
          .innerJoin('match', 'match.id', 'tracking.match')
          .where('match.santa', '=', player.id)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('carrier')
          .selectAll()
          .where('id', '=', carrier)
          .executeTakeFirstOrThrow(),
      ]);
      const trackingBadge = await db
        .selectFrom('badge')
        .selectAll()
        .where('id', '=', settings.sent_present_badge_id)
        .executeTakeFirst();
      if (match == null || match.tracking_count >= 5) {
        throw new BadRequestError(`Already 5 tracking for ${match_id}`);
      }
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

      if (trackingBadge != null && countTracking === 0) {
        return reply.redirect(`/badge/${trackingBadge.id}`, 303);
      }
      return reply.redirect('/', 303);
    }
  );
};
