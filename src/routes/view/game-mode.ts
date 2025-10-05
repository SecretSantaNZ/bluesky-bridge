import type { FastifyPluginAsync } from 'fastify';
import { BadRequestError, NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const gameMode: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get('/game-mode', function (request, reply) {
    return reply.nunjucks('player/game-mode');
  });

  app.post(
    '/game-mode',
    {
      schema: {
        body: z.object({
          game_mode: z.enum(['Regular', 'Super Santa']),
          max_giftees: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const playerDid = request.tokenSubject as string;
      const { game_mode, max_giftees } = request.body;
      if (game_mode === 'Super Santa' && (!max_giftees || max_giftees < 2)) {
        throw new BadRequestError(
          'Must opt in to at least 2 giftees if super santa'
        );
      }
      const settings = await this.blueskyBridge.db
        .selectFrom('settings')
        .selectAll()
        .executeTakeFirstOrThrow();
      if (!settings.signups_open) {
        throw new BadRequestError('Signups are closed');
      }
      let defaultedMaxGiftees = max_giftees;
      if (game_mode === 'Regular') {
        defaultedMaxGiftees = 1;
      }
      const { playerService } = app.blueskyBridge;
      const player = await playerService.patchPlayer(playerDid, {
        ...request.body,
        max_giftees: defaultedMaxGiftees,
      });
      if (player == null) {
        throw new NotFoundError();
      }

      return reply.redirect('/', 303);
    }
  );
};
