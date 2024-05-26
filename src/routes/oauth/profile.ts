import type { FastifyPluginAsync } from 'fastify';
import { validateAuth } from '../../util/validateAuth.js';
import { unauthenticatedAgent } from '../../bluesky.js';

export const profile: FastifyPluginAsync = async (app) => {
  app.get(
    '/profile',
    {
      onRequest: validateAuth(({ authTokenManager }) => authTokenManager),
    },
    async function handler(request, reply) {
      const profile = await unauthenticatedAgent.getProfile({
        actor: request.tokenSubject as string,
      });

      return reply.send(profile.data);
    }
  );
};
