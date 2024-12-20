import type { FastifyPluginAsync } from 'fastify';
import { validateAuth } from '../../util/validateAuth.js';
import { NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const player: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager, 'session')
  );

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
          })
          .partial(),
      },
    },
    async function handler(request, reply) {
      const did = request.tokenSubject as string;
      const address = request.body.address;
      const { playerService } = app.blueskyBridge;
      const player = await playerService.patchPlayer(did, {
        ...request.body,
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
