import type { FastifyPluginAsync } from 'fastify';
import { queryFullNudge } from '../../../lib/database/nudge.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';

export const nudges: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get('/nudges', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [nudges] = await Promise.all([
      queryFullNudge(db).orderBy('nudge.id', 'desc').execute(),
    ]);
    return reply.view('admin/nudges', {
      nudges,
    });
  });

  app.post(
    '/nudges/:nudge_id/delete',
    {
      schema: {
        params: z.object({
          nudge_id: z.coerce.number(),
        }),
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const { db } = app.blueskyBridge;

      await db
        .deleteFrom('nudge')
        .where('id', '=', request.params.nudge_id)
        .execute();

      return reply.view('common/server-events', {
        nudgeEvents: [{ deleted: { nudge_id: request.params.nudge_id } }],
      });
    }
  );
};
