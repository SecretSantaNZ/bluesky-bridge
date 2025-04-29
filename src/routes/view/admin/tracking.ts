import type { FastifyPluginAsync } from 'fastify';
import { queryTrackingWithGifteeAndSanta } from '../../../lib/database/index.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as dateUtils from '../../../lib/dates.js';
import { escapeUnicode } from '../../../util/escapeUnicode.js';

export const tracking: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get('/tracking', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [tracking, carriers] = await Promise.all([
      queryTrackingWithGifteeAndSanta(db).orderBy('tracking.id desc').execute(),
      db.selectFrom('carrier').selectAll().orderBy('id asc').execute(),
    ]);
    const pageData = {
      tracking,
    };
    return reply.view(
      'admin/tracking.ejs',
      {
        ...dateUtils,
        pageData,
        carriers,
        oneColumn: true,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });

  app.post(
    '/tracking/deactivate',
    {
      schema: {
        body: z.object({
          tracking_id: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { tracking_id } = request.body;
      const { db } = this.blueskyBridge;
      await db
        .updateTable('tracking')
        .set({ deactivated: new Date().toISOString() })
        .where('id', '=', tracking_id)
        .executeTakeFirstOrThrow();

      reply.header(
        'HX-Trigger',
        JSON.stringify({
          'ss-tracking-deactivated': { id: request.body.tracking_id },
        })
      );
      return reply.code(204).send();
    }
  );

  app.post(
    '/tracking/update',
    {
      schema: {
        body: z.object({
          tracking_id: z.coerce.number(),
          shipped_date: z.string().date(),
          carrier: z.coerce.number(),
          tracking_number: z.string(),
          giftwrap_status: z.coerce.number().min(0).max(1),
        }),
      },
    },
    async function handler(request, reply) {
      const {
        tracking_id,
        shipped_date,
        carrier,
        tracking_number,
        giftwrap_status,
      } = request.body;
      const { db } = this.blueskyBridge;
      await db
        .selectFrom('carrier')
        .selectAll()
        .where('id', '=', carrier)
        .executeTakeFirstOrThrow();

      await db
        .updateTable('tracking')
        .set({
          carrier,
          shipped_date,
          tracking_number,
          giftwrap_status,
          missing: null,
        })
        .where('id', '=', tracking_id)
        .executeTakeFirstOrThrow();

      const updatedTracking = await queryTrackingWithGifteeAndSanta(db)
        .where('tracking.id', '=', tracking_id)
        .executeTakeFirstOrThrow();

      reply.header(
        'HX-Trigger',
        escapeUnicode(
          JSON.stringify({
            'ss-tracking-updated': updatedTracking,
            'ss-close-modal': true,
          })
        )
      );

      return reply.code(204).send();
    }
  );
};
