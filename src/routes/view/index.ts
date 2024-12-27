import { randomUUID } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import { validateAuth } from '../../util/validateAuth.js';
import { playerHome } from './player-home.js';
import { adminHome } from './admin-home.js';

export const view: FastifyPluginAsync = async (app) => {
  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager, 'session')
  );

  app.setErrorHandler(async function (error, request, reply) {
    if (error instanceof UnauthorizedError) {
      const { returnTokenManager } = this.blueskyBridge;
      const requestId = randomUUID();

      const returnToken = await returnTokenManager.generateToken(requestId, {
        returnUrl: request.url,
      });
      reply.locals = {
        player: null,
        ...reply.locals,
      };
      return reply.view(
        'auth/login-card.ejs',
        {
          requestId,
          returnToken,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
    request.log.error(error);
  });

  await app.register(playerHome);
  await app.register(adminHome);
};
