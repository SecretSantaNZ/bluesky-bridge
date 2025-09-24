import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Player } from '../../lib/PlayerService.js';
import { NotFoundError } from 'http-errors-enhanced';

export const badge: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/badge/:badge_id',
    {
      schema: {
        params: z.object({
          badge_id: z.coerce.number(),
        }),
      },
    },
    async function (request, reply) {
      const playerDid = request.tokenSubject as string;
      const player = reply.locals?.player as Player;
      const { db } = this.blueskyBridge;

      const [badge, sentBadge, { countTracking }] = await Promise.all([
        db
          .selectFrom('badge')
          .innerJoin('player_badge', 'badge.id', 'player_badge.badge_id')
          .selectAll()
          .where('player_badge.player_did', '=', playerDid)
          .where('badge.id', '=', request.params.badge_id)
          .executeTakeFirst(),
        db
          .selectFrom('badge')
          .innerJoin('settings', 'badge.id', 'settings.sent_present_badge_id')
          .select([
            'badge.id',
            'badge.title',
            'badge.description',
            'badge.image_url',
          ])
          .executeTakeFirst(),
        db
          .selectFrom('tracking')
          .innerJoin('match', 'tracking.match', 'match.id')
          .select(({ fn }) => fn.countAll<number>().as('countTracking'))
          .where('match.santa', '=', player.id)
          .executeTakeFirstOrThrow(),
      ]);
      console.log({ badge, sentBadge, countTracking, params: request.params });
      if (request.params.badge_id === sentBadge?.id && countTracking > 0) {
        return reply.nunjucks('player/badge', { badge: sentBadge });
      }
      if (badge == null) {
        throw new NotFoundError();
      }
      return reply.nunjucks('player/badge', { badge });
    }
  );
};
