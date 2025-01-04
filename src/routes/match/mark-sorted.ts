import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const markSorted: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/mark-sorted',
    {
      schema: {
        body: z.object({
          match_id: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { db } = app.blueskyBridge;

      await db
        .updateTable('match')
        .set({
          followup_action: 'sorted',
        })
        .where('id', '=', request.body.match_id)
        .execute();

      reply.header(
        'HX-Trigger',
        JSON.stringify({
          'ss-reload-data': {},
        })
      );
      return reply.code(204).send();
    }
  );
};
