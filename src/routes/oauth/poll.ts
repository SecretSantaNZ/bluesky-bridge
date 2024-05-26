import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';

declare module 'fastify' {
  export interface FastifyRequest {
    postKey?: string;
  }
}

export const poll: FastifyPluginAsync = async (app) => {
  app.get(
    '/poll',
    {
      onRequest: async function validateAuth(request) {
        let { authorization } = request.headers;
        authorization = authorization?.replace(/^Bearer\s+/, '');
        if (!authorization) {
          throw new UnauthorizedError('No Token');
        }
        try {
          const result =
            await this.blueskyBridge.loginTokenManager.validateToken(
              authorization
            );
          request.postKey = result.postKey;
        } catch (e) {
          const error = e as Error;
          throw new UnauthorizedError(error.message);
        }
      },
    },
    async function handler(request, reply) {
      const { oauthSessionStore } = this.blueskyBridge;
      if (request.postKey == null) {
        throw new UnauthorizedError();
      }

      const authentication = await oauthSessionStore.getAuthCodeForPostKey(
        request.postKey
      );

      const redirectTo = new URL(authentication.redirect_uri);
      redirectTo.searchParams.set('code', authentication.code);
      redirectTo.searchParams.set('state', authentication.state);
      reply.send({ redirectTo: redirectTo.toString() });
    }
  );
};
