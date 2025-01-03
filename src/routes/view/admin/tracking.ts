import type { FastifyPluginAsync } from 'fastify';

export const tracking: FastifyPluginAsync = async (app) => {
  app.get('/tracking', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [tracking] = await Promise.all([
      db
        .selectFrom('tracking')
        .innerJoin('match', 'match.id', 'tracking.match')
        .innerJoin('player as santa', 'santa.id', 'match.santa')
        .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
        .innerJoin('carrier', 'carrier.id', 'tracking.carrier')
        .select([
          'santa.handle as santa_handle',
          'giftee.handle as giftee_handle',
          'carrier.text as carrier',
          'tracking.id as tracking_id',
          'tracking_status',
          'shipped_date',
          'tracking_number',
          'giftwrap_status',
          'missing',
        ])
        .orderBy('tracking.id desc')
        .execute(),
    ]);
    const pageData = {
      tracking,
    };
    return reply.view(
      'admin/tracking.ejs',
      {
        pageData,
        oneColumn: true,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
