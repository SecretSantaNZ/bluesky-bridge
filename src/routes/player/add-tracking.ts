import type { FastifyPluginAsync } from 'fastify';
import { BadRequestError, InternalServerError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { queryFullMatch } from '../../lib/database/match.js';
import { escapeUnicode } from '../../util/escapeUnicode.js';
import { renderPlayerHome } from '../view/player-home.js';

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
      const [match, settings, { cnt: countTracking }] = await Promise.all([
        admin
          ? undefined
          : db
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
          return reply
            .header(
              'HX-Trigger',
              escapeUnicode(
                JSON.stringify({
                  'ss-match-updated': match,
                  'ss-close-modal': true,
                })
              )
            )
            .code(204)
            .send();
        }
        default:
          reply.header(
            'HX-Trigger',
            escapeUnicode(
              JSON.stringify(
                countTracking > 0
                  ? {
                      'ss-close-modal': true,
                    }
                  : {
                      'ss-open-modal': {
                        modal: 'badge-detail',
                        modalData: trackingBadge,
                      },
                    }
              )
            )
          );
          return renderPlayerHome(this.blueskyBridge, request, reply);
      }
    }
  );
};
