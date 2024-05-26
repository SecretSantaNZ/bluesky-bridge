import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { OauthPluginOptions } from './types.js';

export const start: FastifyPluginAsync<OauthPluginOptions> = async (
  app,
  { oauthSessionStore, loginTokenManager }
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
      const postKey = await oauthSessionStore.startAuth(request.query);

      const loginToken = await loginTokenManager.generateToken(postKey);
      const requiredPost = `!SecretSantaNZ let me in ${postKey}`;
      reply.send({ requiredPost, loginToken });
    }
  );
};
