import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const tracking: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/tracking/:tracking_id/:action',
    {
      schema: {
        params: z.object({
          tracking_id: z.coerce.number(),
          action: z.enum(['missing', 'arrived']),
        }),
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const did = request.tokenSubject as string;
      const { db, playerService } = app.blueskyBridge;
      const player = await playerService.getPlayer(did);
      if (player == null) {
        throw new NotFoundError();
      }
      await db
        .selectFrom('tracking')
        .innerJoin('match', 'match.id', 'tracking.match')
        .selectAll()
        .where('match.giftee', '=', player.id)
        .where('tracking.id', '=', request.params.tracking_id)
        .executeTakeFirstOrThrow();

      await db
        .updateTable('tracking')
        .set({
          missing:
            request.params.action === 'missing'
              ? new Date().toISOString()
              : null,
        })
        .where('id', '=', request.params.tracking_id)
        .execute();

      return reply.code(204).header('HX-Refresh', 'true').send();
    }
  );
};
