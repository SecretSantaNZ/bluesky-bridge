import type { FastifyPluginAsync } from 'fastify';
import { BadRequestError, NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const updateGameMode: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/update-game-mode',
    {
      schema: {
        body: z.object({
          game_mode: z.enum(['Regular', 'Super Santa']),
          max_giftees: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { game_mode, max_giftees } = request.body;
      if (game_mode === 'Super Santa' && (!max_giftees || max_giftees < 2)) {
        throw new BadRequestError(
          'Must opt in to at least 2 giftees if super santa'
        );
      }
      const playerDid = request.playerDid as string;
      const settings = await this.blueskyBridge.db
        .selectFrom('settings')
        .selectAll()
        .executeTakeFirstOrThrow();
      if (!request.tokenData?.admin && !settings.signups_open) {
        throw new BadRequestError('Signups are closed');
      }
      const { playerService } = app.blueskyBridge;
      const player = await playerService.patchPlayer(playerDid, {
        ...request.body,
        ...(request.body.game_mode === 'Regular'
          ? { max_giftees: 1 }
          : undefined),
      });
      if (player == null) {
        throw new NotFoundError();
      }

      if (request.adminMode) {
        reply.header(
          'HX-Trigger',
          JSON.stringify({
            'ss-player-updated': player,
            'ss-close-modal': true,
          })
        );
      } else {
        reply.header('HX-Refresh', 'true');
      }
      return reply.code(204).send();
    }
  );
};
