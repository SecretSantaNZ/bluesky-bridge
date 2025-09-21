import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const logout: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/logout',
    {
      schema: {
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      return reply.clearCookie('session').nunjucks('common/server-events', {
        reload: true,
      });
    }
  );
};
