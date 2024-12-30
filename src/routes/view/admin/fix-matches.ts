import type { FastifyPluginAsync } from 'fastify';

export const fixMatches: FastifyPluginAsync = async (app) => {
  app.get('/fix-matches', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [brokenMatches] = await Promise.all([
      db
        .selectFrom('match')
        .innerJoin('player as santa', 'santa.id', 'match.santa')
        .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
        .select([
          'santa.handle as santa_handle',
          'santa.deactivated as santa_deactivated',
          'santa.booted as santa_booted',
          'giftee.handle as giftee_handle',
          'giftee.deactivated as giftee_deactivated',
          'giftee.booted as giftee_booted',
          'match.id',
          'match.match_status',
        ])
        .where('match.invalid_player', '=', 1)
        .where('match.deactivated', 'is', null)
        .orderBy('match.id asc')
        .execute(),
    ]);
    return reply.view(
      'admin/fix-matches.ejs',
      { brokenMatches, oneColumn: true },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
