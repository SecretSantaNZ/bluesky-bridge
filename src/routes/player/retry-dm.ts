import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

export const retryDm: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.post('/retry-dm', {}, async function handler(request, reply) {
    const playerDid = request.playerDid as string;
    const { playerService } = app.blueskyBridge;
    await playerService.retryPlayerDms(playerDid);

    return reply.redirect('/', 303);
  });
};
