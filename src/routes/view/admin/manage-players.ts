import type { FastifyPluginAsync } from 'fastify';

export const managePlayers: FastifyPluginAsync = async (app) => {
  app.get('/manage-players', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const players = await db
      .selectFrom('player')
      .selectAll()
      .orderBy('id asc')
      .execute();
    return reply.view(
      'admin/manage-players.ejs',
      { players, oneColumn: true },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
