import type { FastifyPluginAsync } from 'fastify';
import { queryFullNudge } from '../../../lib/database/nudge.js';

export const nudges: FastifyPluginAsync = async (app) => {
  app.get('/nudges', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [nudges] = await Promise.all([
      queryFullNudge(db).orderBy('nudge.id', 'desc').execute(),
    ]);
    const pageData = {
      nudges,
    };
    return reply.view(
      'admin/nudges.ejs',
      {
        pageData,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
