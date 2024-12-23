import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const optIn: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/opt-in',
    {
      schema: {
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const did = request.tokenSubject as string;
      const { playerService } = app.blueskyBridge;
      const player = await playerService.patchPlayer(did, {
        opted_out: false,
      });
      if (player == null) {
        throw new NotFoundError();
      }

      return reply.code(204).header('HX-Refresh', 'true').send();
    }
  );
};
