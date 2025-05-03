import type { FastifyPluginAsync } from 'fastify';

export const badges: FastifyPluginAsync = async (app) => {
  app.get('/badges', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [badges, settings] = await Promise.all([
      db.selectFrom('badge').selectAll().orderBy('id desc').execute(),
      db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
    ]);
    return reply.view(
      'admin/badges.ejs',
      {
        badges,
        settings,
        oneColumn: true,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
