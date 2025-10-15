import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const deleteDrafts: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/delete-drafts',
    {
      schema: {
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const { db } = app.blueskyBridge;

      await db
        .deleteFrom('match')
        .where('match_status', '=', 'draft')
        .execute();

      return reply.redirect('/admin/draft-matches', 303);
    }
  );
};
