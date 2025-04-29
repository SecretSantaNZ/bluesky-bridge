import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { escapeUnicode } from '../../util/escapeUnicode.js';

export const refreshFollowing: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/refresh-following',
    {
      schema: {
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const playerDid = request.playerDid as string;
      const { playerService } = app.blueskyBridge;
      const player = await playerService.refreshFollowing(playerDid);
      if (player == null) {
        throw new NotFoundError();
      }

      if (request.adminMode) {
        reply.header(
          'HX-Trigger',
          escapeUnicode(
            JSON.stringify({
              'ss-player-updated': player,
            })
          )
        );
      } else {
        reply.header('HX-Refresh', 'true');
      }
      return reply.code(204).send();
    }
  );
};
