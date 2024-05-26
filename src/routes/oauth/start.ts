import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { OauthPluginOptions } from './types.js';

export const start: FastifyPluginAsync<OauthPluginOptions> = async (
  app,
  { oauthSessionStore }
) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/start',
    {
      schema: {
        querystring: z.object({
          response_type: z.literal('code'),
          client_id: z.string(),
          redirect_uri: z.string(),
          scope: z.string(),
          state: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const requiredPost = await oauthSessionStore.startAuth(request.query);
      reply.send({ requiredPost });
    }
  );
};
