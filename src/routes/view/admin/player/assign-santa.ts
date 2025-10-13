import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadPlayersWhoCanHaveMoreGifees } from '../../../../lib/database/loadPlayersWhoCanHaveMoreGifees.js';

export const assignSanta: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/assign-santa',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { db, playerService } = this.blueskyBridge;

      const [player, playersWhoCanHaveMoreGifees] = await Promise.all([
        playerService.getPlayerById(request.params.player_id),
        loadPlayersWhoCanHaveMoreGifees(db),
      ]);

      return reply.view('admin/player/assign-santa.njk', {
        player,
        playersWhoCanHaveMoreGifees,
      });
    }
  );

  app.post(
    '/assign-santa',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
        body: z.object({
          santa_handle: z.string(),
        }),
      },
    },
    async function handler(request, reply) {
      const { db } = app.blueskyBridge;

      const [santa, giftee] = await Promise.all([
        db
          .selectFrom('player')
          .selectAll()
          .where('deactivated', '=', 0)
          .where('handle', '=', request.body.santa_handle)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('player')
          .selectAll()
          .where('deactivated', '=', 0)
          .where('id', '=', request.params.player_id)
          .executeTakeFirstOrThrow(),
      ]);

      await db
        .insertInto('match')
        .values({
          santa: santa.id,
          giftee: giftee.id,
          has_present: 0,
          invalid_player: 0,
          match_status: 'draft',
          nudge_count: 0,
          nudge_present_update_count: 0,
          tracking_count: 0,
          tracking_missing_count: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return reply.redirect('/admin/fix-matches', 303);
    }
  );
};
