import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const managePlayers: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/manage-players',
    {
      schema: {
        querystring: z.object({ handle: z.string() }).partial(),
      },
    },
    async function (request, reply) {
      const { db } = this.blueskyBridge;
      const players = await db
        .selectFrom('player')
        .selectAll()
        .orderBy('id asc')
        .execute();
      return reply.view(
        'admin/manage-players.ejs',
        {
          players,
          oneColumn: true,
          initialFilter: request.query.handle ?? '',
          replaceUrl: request.routerPath,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
  );
};
