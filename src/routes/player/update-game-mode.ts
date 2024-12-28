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
          player_did: z.string().optional(),
        }),
      },
    },
    async function handler(request, reply) {
      const { game_mode, max_giftees, player_did, ...rest } = request.body;
      let did = request.tokenSubject as string;
      if (request.tokenData?.admin && player_did) {
        did = player_did;
      }
      if (game_mode === 'Super Santa' && (!max_giftees || max_giftees < 2)) {
        throw new BadRequestError(
          'Must opt in to at least 2 giftees if super santa'
        );
      }
      const settings = await this.blueskyBridge.db
        .selectFrom('settings')
        .selectAll()
        .executeTakeFirstOrThrow();
      if (!request.tokenData?.admin && !settings.signups_open) {
        throw new BadRequestError('Signups are closed');
      }
      const { playerService } = app.blueskyBridge;
      const player = await playerService.patchPlayer(did, {
        ...rest,
        game_mode,
        max_giftees,
        ...(request.body.game_mode === 'Regular'
          ? { max_giftees: 1 }
          : undefined),
      });
      if (player == null) {
        throw new NotFoundError();
      }

      return reply.code(204).header('HX-Refresh', 'true').send();
    }
  );
};
