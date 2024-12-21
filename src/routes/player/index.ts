import type { FastifyPluginAsync } from 'fastify';
import { validateAuth } from '../../util/validateAuth.js';
import { BadRequestError, NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const player: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager, 'session')
  );

  app.addHook('preValidation', function (request) {
    if (request.method === 'get') return;

    const { csrfToken } = z
      .object({ csrfToken: z.string() })
      .parse(request.body);
    if (csrfToken !== request.tokenData?.csrfToken || !csrfToken) {
      throw new BadRequestError('invalid csrf token');
    }
  });

  app.get('/', async function handler(request, reply) {
    const did = request.tokenSubject as string;
    const { playerService } = app.blueskyBridge;
    const player = await playerService.getPlayer(did);

    if (player == null) {
      throw new NotFoundError();
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, address_review_required, ...noIdPlayer } = player;

    return reply.send(noIdPlayer);
  });

  app.patch(
    '/',
    {
      schema: {
        body: z
          .object({
            address: z.string(),
            delivery_instructions: z.string(),
            game_mode: z.enum(['Regular', 'Super Santa']),
            max_giftees: z.coerce.number(),
          })
          .partial(),
      },
    },
    async function handler(request, reply) {
      const { address, game_mode, max_giftees } = request.body;
      const did = request.tokenSubject as string;
      if (game_mode === 'Super Santa' && (!max_giftees || max_giftees < 2)) {
        throw new BadRequestError(
          'Must opt in to at least 2 giftees if super santa'
        );
      }
      const { playerService } = app.blueskyBridge;
      const player = await playerService.patchPlayer(did, {
        ...request.body,
        ...(request.body.game_mode === 'Regular'
          ? { max_giftees: 1 }
          : undefined),
        address_review_required:
          address == null ? undefined : !address.match(/new zealand|aotearoa/i),
      });
      if (player == null) {
        throw new NotFoundError();
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, address_review_required, ...noIdPlayer } = player;

      return reply.code(204).header('HX-Refresh', 'true').send();
    }
  );
};
