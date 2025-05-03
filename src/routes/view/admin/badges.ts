import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { UpdateObject } from 'kysely';
import { z } from 'zod';
import type { DatabaseSchema } from '../../../lib/database/schema.js';

export const badges: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

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

  app.get(
    '/badges/:badge_id',
    {
      schema: {
        params: z.object({
          badge_id: z.coerce.number(),
        }),
      },
    },
    async function (request, reply) {
      const { db } = this.blueskyBridge;
      const [badge, settings] = await Promise.all([
        db
          .selectFrom('badge')
          .selectAll()
          .where('id', '=', request.params.badge_id)
          .executeTakeFirstOrThrow(),
        db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
      ]);

      let assigned_for_type = 'nothing';
      if (settings.current_game_badge_id === badge.id) {
        assigned_for_type = 'current_game';
      } else if (settings.sent_present_badge_id === badge.id) {
        assigned_for_type = 'sent_present';
      } else if (settings.super_santa_badge_id === badge.id) {
        assigned_for_type = 'super_santa';
      } else if (badge.assigned_by_hashtag) {
        if (badge.assigned_by_elf) {
          assigned_for_type = 'by_elf';
        } else {
          assigned_for_type = 'posting';
        }
      }
      return reply.view(
        'admin/badge.ejs',
        {
          badge,
          assigned_for_type,
          settings,
          oneColumn: true,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
  );

  app.post(
    '/badges/:badge_id',
    {
      schema: {
        params: z.object({
          badge_id: z.coerce.number(),
        }),
        body: z.object({
          title: z.string(),
          description: z.string(),
          image_url: z.string(),
          assigned_for_type: z.enum([
            'nothing',
            'current_game',
            'sent_present',
            'super_santa',
            'by_elf',
            'posting',
          ]),
          assigned_by_hashtag: z.string().optional(),
        }),
      },
    },
    async function (request, reply) {
      const { badge_id } = request.params;
      const { db, settingsChanged } = this.blueskyBridge;

      const settings = await db
        .selectFrom('settings')
        .selectAll()
        .executeTakeFirstOrThrow();

      const settingsUpdate: UpdateObject<DatabaseSchema, 'settings'> = {};
      if (settings.current_game_badge_id == badge_id) {
        settingsUpdate.current_game_badge_id = null;
      }
      if (settings.sent_present_badge_id == badge_id) {
        settingsUpdate.sent_present_badge_id = null;
      }
      if (settings.super_santa_badge_id == badge_id) {
        settingsUpdate.super_santa_badge_id = null;
      }
      let assigned_by_hashtag: string | null = null;
      switch (request.body.assigned_for_type) {
        case 'current_game':
          settingsUpdate.current_game_badge_id = badge_id;
          break;
        case 'sent_present':
          settingsUpdate.sent_present_badge_id = badge_id;
          break;
        case 'super_santa':
          settingsUpdate.super_santa_badge_id = badge_id;
          break;
        case 'by_elf':
        case 'posting':
          assigned_by_hashtag = request.body.assigned_by_hashtag || null;
          break;
      }

      await db
        .updateTable('badge')
        .set({
          title: request.body.title,
          description: request.body.description,
          image_url: request.body.image_url,
          assigned_by_hashtag,
          assigned_by_elf: request.body.assigned_for_type === 'by_elf' ? 1 : 0,
        })
        .where('id', '=', badge_id)
        .returningAll()
        .executeTakeFirst();
      if (Object.keys(settingsUpdate).length > 0) {
        await db
          .updateTable('settings')
          .set(settingsUpdate)
          .executeTakeFirstOrThrow();
      }
      settingsChanged(settings);

      return reply.code(204).header('HX-Redirect', '/admin/badges').send();
    }
  );
};
