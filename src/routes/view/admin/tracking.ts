import type { FastifyPluginAsync } from 'fastify';
import { queryTrackingWithGifteeAndSanta } from '../../../lib/database/index.js';
export const tracking: FastifyPluginAsync = async (app) => {
  app.get('/tracking', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [tracking] = await Promise.all([
      queryTrackingWithGifteeAndSanta(db).orderBy('tracking.id desc').execute(),
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
