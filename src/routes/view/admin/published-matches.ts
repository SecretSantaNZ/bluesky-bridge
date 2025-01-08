import type { FastifyPluginAsync } from 'fastify';
import * as dateUtils from '../../../lib/dates.js';
import { queryFullMatch } from '../../../lib/database/index.js';

export const publishedMatches: FastifyPluginAsync = async (app) => {
  app.get('/published-matches', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [publishedMatches, carriers] = await Promise.all([
      queryFullMatch(db)
        .where('match.match_status', '<>', 'draft')
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
