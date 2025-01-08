import type { FastifyPluginAsync } from 'fastify';
import { BadRequestError, InternalServerError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { queryFullMatch } from '../../lib/database/match.js';

export const addTracking: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/add-tracking',
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
      const admin = request.tokenData?.admin;
      const [match] = await Promise.all([
        admin
          ? undefined
          : db
              .selectFrom('match')
              .selectAll()
              .where('santa', '=', player.id)
              .where('id', '=', match_id)
              .executeTakeFirstOrThrow(),
        db
          .selectFrom('carrier')
          .selectAll()
          .where('id', '=', carrier)
          .executeTakeFirstOrThrow(),
      ]);
      if (!admin) {
        if (match == null || match.tracking_count >= 5) {
          throw new BadRequestError(`Already 5 tracking for ${match_id}`);
        }
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

      const currentUrl = request.headers['hx-current-url'];
      switch (currentUrl && new URL(currentUrl).pathname) {
        case '/admin/published-matches': {
          const match = await queryFullMatch(db)
            .where('match.id', '=', match_id)
            .executeTakeFirstOrThrow();
          reply.header(
            'HX-Trigger',
            JSON.stringify({
              'ss-match-updated': match,
              'ss-close-modal': true,
            })
          );
          break;
        }
        default:
          reply.header('HX-Refresh', 'true');
          break;
      }

      return reply.code(204).send();
    }
  );
};
