import type { FastifyPluginAsync } from 'fastify';
import { ForbiddenError, NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { escapeUnicode } from '../../util/escapeUnicode.js';

export const restorePlayer: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/restore-player',
    {
      schema: {
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      if (!request.adminMode) {
        throw new ForbiddenError();
      }
      const playerDid = request.playerDid as string;
      const { playerService, db } = app.blueskyBridge;
      const player = await playerService.patchPlayer(playerDid, {
        booted: null,
        booted_by: null,
        opted_out: false,
      });
      if (player == null) {
        throw new NotFoundError();
      }

      const updatedPlayer = await db
        .selectFrom('player')
        .selectAll()
        .where('did', '=', playerDid)
        .executeTakeFirst();
      reply.header(
        'HX-Trigger',
        escapeUnicode(
          JSON.stringify({
            'ss-player-updated': updatedPlayer,
          })
        )
      );
      return reply.code(204).send();
    }
  );
};
