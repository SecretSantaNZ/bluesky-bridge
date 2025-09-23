import type { FastifyPluginAsync } from 'fastify';
import { BadRequestError, NotFoundError } from 'http-errors-enhanced';
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
      const settings = await this.blueskyBridge.db
        .selectFrom('settings')
        .selectAll()
        .executeTakeFirstOrThrow();
      if (!settings.signups_open) {
        throw new BadRequestError('Signups are closed');
      }
      const player = await playerService.patchPlayer(did, {
        opted_out: false,
      });
      if (player == null) {
        throw new NotFoundError();
      }

      return reply.nunjucks('common/server-events', {
        redirectTo: '/',
        startRequestFrom: '#opt-in',
      });
    }
  );
};
