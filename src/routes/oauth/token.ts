import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const token: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/token',
    {
      // Type to any to avoid this messing with the type of request and breaking the schema
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      preHandler: app.basicAuth as any,
      schema: {
        body: z.object({
          grant_type: z.literal('authorization_code'),
          code: z.string(),
          redirect_uri: z.string(),
        }),
      },
    },
    async function handler(request, reply) {
      const { oauthSessionStore, authTokenManager } = this.blueskyBridge;

      const authentication = await oauthSessionStore.completeAuth(
        request.tokenSubject as string,
        request.body
      );
      const authToken = await authTokenManager.generateToken(
        authentication.user_did
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
