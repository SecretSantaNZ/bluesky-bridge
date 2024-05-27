import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import { validateAuth } from '../../util/validateAuth.js';

export const poll: FastifyPluginAsync = async (app) => {
  app.get(
    '/poll',
    {
      onRequest: validateAuth(({ loginTokenManager }) => loginTokenManager),
    },
    async function handler(request, reply) {
      const { oauthSessionStore } = this.blueskyBridge;
      if (request.tokenSubject == null) {
        throw new UnauthorizedError();
      }

      const authentication = await oauthSessionStore.getAuthCodeForPostKey(
        request.tokenSubject
      );

      const redirectTo = new URL(authentication.redirect_uri);
      redirectTo.searchParams.set('code', authentication.auth_code);
      redirectTo.searchParams.set('state', authentication.state);
      reply.send({ redirectTo: redirectTo.toString() });
    }
  );
};
