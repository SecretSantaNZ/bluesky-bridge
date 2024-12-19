import { randomUUID } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import { validateAuth } from '../../util/validateAuth.js';

export const view: FastifyPluginAsync = async (app) => {
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
      return reply.view('oauth/start.ejs', { requestId });
    }
    return this.errorHandler(error, request, reply);
  });

  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager, 'session')
  );

  app.get('/', async function (request, reply) {
    return reply.send({ hello: 'world' });
  });

  app.get('/test', async function (request, reply) {
    return reply.send({ hello: 'world' });
  });
};
