import { randomUUID } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import { validateAuth } from '../../util/validateAuth.js';

export const view: FastifyPluginAsync = async (app) => {
  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager, 'session')
  );
  app.addHook('onRequest', async function (request, reply) {
    const playerDid = request.tokenSubject as string;
    const player = await app.blueskyBridge.playerService.getPlayer(playerDid);
    if (!player) {
      throw new UnauthorizedError();
    }
    reply.locals = { ...reply.locals, player };
    const hasAddress = Boolean(player.address && player.address.trim());
    if (!hasAddress) {
      return reply.view(
        'player/address.ejs',
        { player },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
  });

  app.setErrorHandler(async function (error, request, reply) {
    if (error instanceof UnauthorizedError) {
      const { loginTokenManager } = this.blueskyBridge;
      const requestId = randomUUID();

      const loginToken = await loginTokenManager.generateToken(requestId, {
        returnUrl: request.url,
      });
      reply.setCookie('login-session', loginToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
      });
      reply.locals = {
        player: null,
        ...reply.locals,
      };
      return reply.view(
        'auth/login.ejs',
        {
          requestId,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
  });

  app.get('/', async function (request, reply) {
    return reply.send({ hello: 'world' });
  });

  app.get('/test', async function (request, reply) {
    return reply.send({ hello: 'world' });
  });
};
