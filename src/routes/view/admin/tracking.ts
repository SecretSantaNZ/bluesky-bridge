import type { FastifyPluginAsync } from 'fastify';
import { queryTrackingWithGifteeAndSanta } from '../../../lib/database/index.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const tracking: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get('/tracking', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [tracking, carriers] = await Promise.all([
      queryTrackingWithGifteeAndSanta(db)
        .orderBy('tracking.id', 'desc')
        .execute(),
      db.selectFrom('carrier').selectAll().orderBy('id', 'asc').execute(),
    ]);
    return reply.nunjucks('admin/tracking', {
      tracking,
      carriers,
    });
  });

  app.get(
    '/tracking/:tracking_id',
    {
      schema: {
        params: z.object({
          tracking_id: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { tracking_id } = request.params;
      const { db } = this.blueskyBridge;

      const [carriers, trackingRecord] = await Promise.all([
        db.selectFrom('carrier').selectAll().orderBy('id', 'asc').execute(),
        queryTrackingWithGifteeAndSanta(db)
          .where('tracking.id', '=', tracking_id)
          .executeTakeFirstOrThrow(),
      ]);

      return reply.nunjucks('admin/tracking/edit', {
        carriers,
        trackingRecord,
        trackingEvents: [{ updated: trackingRecord }],
      });
    }
  );

  app.post(
    '/tracking/:tracking_id',
    {
      schema: {
        params: z.object({
          tracking_id: z.coerce.number(),
        }),
        body: z.object({
          shipped_date: z.string().date(),
          carrier: z.coerce.number(),
          tracking_number: z.string(),
          giftwrap_status: z.coerce.number().min(0).max(1),
        }),
      },
    },
    async function handler(request, reply) {
      const { tracking_id } = request.params;
      const { shipped_date, carrier, tracking_number, giftwrap_status } =
        request.body;
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

      return reply.redirect(`/admin/tracking/${tracking_id}`);
    }
  );

  app.post(
    '/tracking/:tracking_id/deactivate',
    {
      schema: {
        params: z.object({
          tracking_id: z.coerce.number(),
        }),
      },
    },
    async function handler(request, reply) {
      const { tracking_id } = request.params;
      const { db } = this.blueskyBridge;
      await db
        .updateTable('tracking')
        .set({ deactivated: new Date().toISOString() })
        .where('id', '=', tracking_id)
        .executeTakeFirstOrThrow();

      return reply.nunjucks('common/server-events', {
        trackingEvents: [{ deactivated: { tracking_id } }],
      });
    }
  );

  app.post(
    '/tracking/:tracking_id/:action',
    {
      schema: {
        params: z.object({
          tracking_id: z.coerce.number(),
          action: z.enum(['missing', 'arrived']),
        }),
        body: z.object({}),
      },
    },
    async function handler(request, reply) {
      const { tracking_id } = request.params;
      const { db } = app.blueskyBridge;

      await db
        .updateTable('tracking')
        .set({
          missing:
            request.params.action === 'missing'
              ? new Date().toISOString()
              : null,
        })
        .where('id', '=', tracking_id)
        .execute();

      const trackingRecord = await queryTrackingWithGifteeAndSanta(db)
        .where('tracking.id', '=', tracking_id)
        .executeTakeFirstOrThrow();

      return reply.nunjucks('common/server-events', {
        trackingEvents: [{ updated: trackingRecord }],
      });
    }
  );
};
