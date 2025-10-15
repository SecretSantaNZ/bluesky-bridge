import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { UpdateObject } from 'kysely';
import { z } from 'zod';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { S3Client } from '@aws-sdk/client-s3';
import type { DatabaseSchema } from '../../../lib/database/schema.js';
import { randomUUID } from 'crypto';

const assignedForTypeSchema = z.enum([
  'nothing',
  'current_game',
  'sent_present',
  'super_santa',
  'by_elf',
  'posting',
]);

export const badges: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.get('/badges', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [badges, settings] = await Promise.all([
      db.selectFrom('badge').selectAll().orderBy('id', 'desc').execute(),
      db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
    ]);
    return reply.view('admin/badges', {
      badges,
      settings,
    });
  });

  app.get(
    '/badges/:badge_id',
    {
      schema: {
        params: z.object({
          badge_id: z.union([z.literal('__new__'), z.coerce.number()]),
        }),
      },
    },
    async function (request, reply) {
      const { db } = this.blueskyBridge;
      const [badge, settings] = await Promise.all([
        request.params.badge_id == '__new__'
          ? {
              id: 0,
              title: '',
              description: '',
              image_url: '',
              assigned_by_elf: 0,
              assigned_by_hashtag: '',
            }
          : db
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
      return reply.view('admin/badge', {
        badge: { ...badge, assigned_for_type },
      });
    }
  );

  app.post(
    '/badges/presign-upload',
    {
      schema: {
        body: z.object({
          filename: z.string(),
          content_type: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const client = new S3Client({
        region: process.env.IMAGE_BUCKET_REGION,
      });
      const Bucket = process.env.IMAGE_BUCKET ?? '??IMAGE_BUCKET??';
      const name = `${request.body.filename.replace(/\.[^.]+$/, '')}-${randomUUID()}`;
      const Key = `${process.env.IMAGE_KEY_PREFIX}${name}`;
      const Fields = {
        'Cache-Control': 'max-age=31536000, immutable',
        'Content-Type': request.body.content_type,
      };
      const { url, fields } = await createPresignedPost(client, {
        Bucket,
        Key,
        Fields,
        Expires: 300,
      });

      return reply.view('admin/upload-form', {
        url,
        fields,
        image_url: `https://secretsantanz.imgix.net/${name}?w=386&w386&format=auto`,
      });
    }
  );

  app.post(
    '/badges/:badge_id?',
    {
      schema: {
        params: z.object({
          badge_id: z.coerce.number().optional(),
        }),
        body: z.object({
          title: z.string(),
          description: z.string(),
          image_url: z.string(),
          assigned_for_type: assignedForTypeSchema,
          assigned_by_hashtag: z.string().optional(),
        }),
      },
    },
    async function (request, reply) {
      let badge_id = request.params.badge_id;
      const { db, settingsChanged } = this.blueskyBridge;

      const assigned_by_hashtag =
        request.body.assigned_for_type === 'by_elf' ||
        request.body.assigned_for_type === 'posting'
          ? request.body.assigned_by_hashtag || null
          : null;

      if (badge_id) {
        await db
          .updateTable('badge')
          .set({
            title: request.body.title,
            description: request.body.description,
            image_url: request.body.image_url,
            assigned_by_hashtag,
            assigned_by_elf:
              request.body.assigned_for_type === 'by_elf' ? 1 : 0,
          })
          .where('id', '=', badge_id)
          .returningAll()
          .executeTakeFirst();
      } else {
        const badge = await db
          .insertInto('badge')
          .values({
            title: request.body.title,
            description: request.body.description,
            image_url: request.body.image_url,
            assigned_by_hashtag,
            assigned_by_elf:
              request.body.assigned_for_type === 'by_elf' ? 1 : 0,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        badge_id = badge.id;
      }

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
      }
      if (Object.keys(settingsUpdate).length > 0) {
        await db
          .updateTable('settings')
          .set(settingsUpdate)
          .executeTakeFirstOrThrow();
      }
      settingsChanged(settings);

      return reply.redirect('/admin/badges', 303);
    }
  );
};
