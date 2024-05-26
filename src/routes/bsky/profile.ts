import type { FastifyPluginAsync } from 'fastify';
import { unauthenticatedAgent } from '../../bluesky.js';

export const profile: FastifyPluginAsync = async (app) => {
  app.get('/profile', async function handler(request, reply) {
    const profile = await unauthenticatedAgent.getProfile({
      actor: request.tokenSubject as string,
    });

    return reply.send(profile.data);
  });
};
