import type { FastifyPluginAsync } from 'fastify';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const updateGameMode: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/update-game-mode',
    {
      schema: {
        body: z.object({
          game_mode: z.enum([
            'Regular',
            'Super Santa',
            'Santa Only',
            'Giftee Only',
          ]),
          max_giftees: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { game_mode, max_giftees } = request.body;
      if (
        !request.tokenData?.admin &&
        game_mode !== 'Super Santa' &&
        game_mode !== 'Regular'
      ) {
        throw new ForbiddenError();
      }
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
      let defaultedMaxGiftees = max_giftees;
      if (game_mode === 'Regular') {
        defaultedMaxGiftees = 1;
      } else if (game_mode === 'Giftee Only') {
        defaultedMaxGiftees = 0;
      }
      const { playerService, db } = app.blueskyBridge;
      const player = await playerService.patchPlayer(playerDid, {
        ...request.body,
        max_giftees: defaultedMaxGiftees,
      });
      if (player == null) {
        throw new NotFoundError();
      }

      if (request.adminMode) {
        const updatedPlayer = await db
          .selectFrom('player')
          .selectAll()
          .where('did', '=', playerDid)
          .executeTakeFirst();
        reply.header(
          'HX-Trigger',
          JSON.stringify({
            'ss-player-updated': updatedPlayer,
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
