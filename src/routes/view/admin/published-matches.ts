import type { FastifyPluginAsync } from 'fastify';
import * as dateUtils from '../../../lib/dates.js';

export const publishedMatches: FastifyPluginAsync = async (app) => {
  app.get('/published-matches', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [publishedMatches, carriers] = await Promise.all([
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
          'match.invalid_player as invalid_player',
          'match.id as match_id',
          'match.match_status',
          'match.nudge_count',
          'match.tracking_count',
        ])
        .where('match.match_status', '<>', 'draft')
        .where('match.deactivated', 'is', null)
        .orderBy('match.id asc')
        .execute(),

      db.selectFrom('carrier').selectAll().orderBy('id asc').execute(),
    ]);
    const pageData = {
      publishedMatches,
    };
    return reply.view(
      'admin/published-matches.ejs',
      {
        ...dateUtils,
        carriers,
        pageData,
        oneColumn: true,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
