import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const retryDm: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/retry-dm',
    {
      schema: {
        body: z.object({ player_did: z.string() }),
      },
    },
    async function handler(request, reply) {
      const playerDid = request.body.player_did;
      const { playerService, db } = app.blueskyBridge;
      await db
        .updateTable('player')
        .set({ player_dm_status: 'queued' })
        .where('did', '=', playerDid)
        .executeTakeFirst();
      const player = await playerService.getPlayer(playerDid);
      if (player == null) {
        throw new NotFoundError();
      }

      return reply
        .header(
          'HX-Trigger',
          JSON.stringify({
            'ss-player-updated': player,
          })
        )
        .code(204)
        .send();
    }
  );
};
