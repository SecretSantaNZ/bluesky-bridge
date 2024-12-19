import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
// import { z } from 'zod';

export const start: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/start',
    {
      schema: {},
    },
    async function handler(request, reply) {
      const { loginTokenManager } = this.blueskyBridge;
      const requestId = randomUUID();

      const loginToken = await loginTokenManager.generateToken(requestId);
      reply.setCookie('login-session', loginToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
      });
      return reply.view('oauth/start.ejs', { requestId });
    }
  );
};
