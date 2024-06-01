import type { FastifyPluginAsync } from 'fastify';

export const authTest: FastifyPluginAsync = async (app) => {
  app.get('/auth-test', async (request, reply) => {
    reply.send({ ok: true });
  });
};
