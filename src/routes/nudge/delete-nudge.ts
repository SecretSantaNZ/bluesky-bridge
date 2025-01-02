import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const deleteNudge: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/delete-nudge',
    {
      schema: {
        body: z.object({
          nudge_id: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { db } = app.blueskyBridge;

      await db
        .deleteFrom('nudge')
        .where('id', '=', request.body.nudge_id)
        .execute();

      reply.header(
        'HX-Trigger',
        JSON.stringify({
          'ss-nudge-deleted': { id: request.body.nudge_id },
        })
      );
      return reply.code(204).send();
    }
  );
};
