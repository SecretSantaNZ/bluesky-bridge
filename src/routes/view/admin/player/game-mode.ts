import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { baseAdminPlayerQuery } from '../manage-players.js';
import { NotFoundError } from 'http-errors-enhanced';
import { resolveMaxGiftees } from '../../../../lib/game-mode.js';

export const gameMode: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/game-mode',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
        querystring: z.object({
          return_to: z.literal('fix-matches').optional(),
        }),
      },
    },
    async function (request, reply) {
      const { db, playerService } = this.blueskyBridge;
      const [player, adminPlayer] = await Promise.all([
        playerService.getPlayerById(request.params.player_id),
        baseAdminPlayerQuery(db)
          .where('player.id', '=', request.params.player_id)
          .executeTakeFirstOrThrow(),
      ]);

      if (player == null) {
        throw new NotFoundError();
      }

      return reply.view('admin/player/game-mode', {
        player,
        player_display_handle:
          player.player_type === 'mastodon'
            ? player.mastodon_account
            : player.handle,
        gameModeOptions: [
          { id: 'Regular', text: 'Regular' },
          { id: 'Super Santa', text: 'Super Santa' },
          { id: 'Santa Only', text: 'Santa Only' },
          { id: 'Giftee Only', text: 'Giftee Only' },
        ],
        playerEvents: [
          {
            updated: adminPlayer,
          },
        ],
        return_to: request.query.return_to,
      });
    }
  );

  app.post(
    '/game-mode',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
        body: z.object({
          game_mode: z.enum([
            'Regular',
            'Super Santa',
            'Santa Only',
            'Giftee Only',
          ]),
          max_giftees: z.coerce.number(),
          return_to: z.literal('fix-matches').optional(),
        }),
      },
    },
    async function handler(request, reply) {
      const { playerService } = app.blueskyBridge;
      const player = await playerService.getPlayerById(
        request.params.player_id
      );
      if (player == null) {
        throw new NotFoundError();
      }
      const { game_mode, max_giftees } = request.body;
      const { return_to, ...rest } = request.body;
      const defaultedMaxGiftees = resolveMaxGiftees(game_mode, max_giftees);
      await playerService.patchPlayer(player.did, {
        ...rest,
        max_giftees: defaultedMaxGiftees,
      });
      if (player == null) {
        throw new NotFoundError();
      }

      if (return_to === 'fix-matches') {
        return reply.redirect('/admin/fix-matches', 303);
      }
      return reply.redirect(`/admin/player/${player.id}/game-mode`, 303);
    }
  );
};
