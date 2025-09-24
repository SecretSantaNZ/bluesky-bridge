import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';

export const optOut: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.get('/opt-out', async function handler(request, reply) {
    return reply.nunjucks('player/opt-out');
  });

  app.post(
    '/opt-out',
    {
      schema: {
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const did = request.tokenSubject as string;
      const { playerService } = app.blueskyBridge;
      const player = await playerService.optOut(did);
      if (player == null) {
        throw new NotFoundError();
      }

      return reply.nunjucks('common/server-events', {
        redirectTo: '/',
        startRequestFrom: '#dialog-content',
      });
    }
  );
};
