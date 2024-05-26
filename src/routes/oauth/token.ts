import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const token: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/token',
    {
      schema: {
        body: z.object({
          grant_type: z.literal('authorization_code'),
          client_id: z.string(),
          client_secret: z.string(),
          code: z.string(),
          redirect_uri: z.string(),
        }),
      },
    },
    async function handler(request, reply) {
      const { oauthSessionStore, authTokenManager } = this.blueskyBridge;

      const authentication = await oauthSessionStore.completeAuth(request.body);
      const authToken = await authTokenManager.generateToken(
        authentication.userDid
      );

      return reply.send({
        token_type: 'Bearer',
        expires_in: authTokenManager.expiresInSeconds,
        access_token: authToken,
        scope: authentication.scope,
      });
    }
  );
};
