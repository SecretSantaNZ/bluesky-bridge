import type { FastifyPluginAsync } from 'fastify';
import { BadRequestError, NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { resolveMaxGiftees } from '../../lib/game-mode.js';
import type { Database } from '../../lib/database/index.js';
import type { PlayerService } from '../../lib/PlayerService.js';

/** Updates the logged in player's game mode after checking signups are still
 *  open and normalizing the giftee limit; returns the updated player or
 *  undefined when the player could not be found. */
export async function updateGifteePreferences(
  db: Database,
  playerService: PlayerService,
  playerDid: string,
  body: { game_mode: 'Regular' | 'Super Santa'; max_giftees: number }
): Promise<Awaited<ReturnType<PlayerService['patchPlayer']>> | undefined> {
  const settings = await db
    .selectFrom('settings')
    .selectAll()
    .executeTakeFirstOrThrow();
  if (!settings.signups_open) {
    throw new BadRequestError('Signups are closed');
  }
  const defaultedMaxGiftees = resolveMaxGiftees(
    body.game_mode,
    body.max_giftees
  );
  const player = await playerService.patchPlayer(playerDid, {
    ...body,
    max_giftees: defaultedMaxGiftees,
  });
  return player ?? undefined;
}

export const gameMode: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get('/game-mode', function (request, reply) {
    return reply.view('player/game-mode', {
      gameModeOptions: [
        { id: 'Regular', text: 'Regular' },
        { id: 'Super Santa', text: 'Super Santa' },
      ],
    });
  });

  app.post(
    '/game-mode',
    {
      schema: {
        body: z.object({
          game_mode: z.enum(['Regular', 'Super Santa']),
          max_giftees: z.coerce
            .number()
            .max(5, 'You can only buy for up to 5 giftees'),
        }),
      },
    },
    async function handler(request, reply) {
      const playerDid = request.tokenSubject as string;
      const { db, playerService } = app.blueskyBridge;
      const player = await updateGifteePreferences(
        db,
        playerService,
        playerDid,
        request.body
      );
      if (player == null) {
        throw new NotFoundError();
      }

      return reply.redirect('/', 303);
    }
  );
};
