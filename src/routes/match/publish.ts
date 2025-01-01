import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const publish: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/publish',
    {
      schema: {
        body: z.object({
          current_status: z.enum(['draft', 'shared', 'locked']),
          target_status: z.enum(['draft', 'shared', 'locked']),
        }),
      },
    },
    async function handler(request, reply) {
      const { db } = app.blueskyBridge;

      await db
        .updateTable('match')
        .set({
          match_status: request.body.target_status,
        })
        .where('deactivated', 'is', null)
        .where('invalid_player', '=', 0)
        .where('match_status', '=', request.body.current_status)
        .execute();

      reply.header('HX-Refresh', 'true');
      return reply.code(204).send();
    }
  );
};
