import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const start: FastifyPluginAsync = async (app) => {
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
    async function handler(request, reply) {
      const { oauthSessionStore, loginTokenManager } = this.blueskyBridge;
      const postKey = await oauthSessionStore.startAuth(request.query);

      const loginToken = await loginTokenManager.generateToken(postKey);
      const requiredPost = `!SecretSantaNZ let me in ${postKey}`;
      return reply.view('oauth/start.ejs', { requiredPost, loginToken });
    }
  );
};
