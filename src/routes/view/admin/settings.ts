import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Settings } from '../../../lib/database/schema.js';

const dataSchema = z.object({
  signups_open: z.coerce.boolean().optional(),
  matches_sent_date: z.string(),
  signups_open_date: z.string(),
  signups_close_date: z.string(),
  send_by_date: z.string(),
  opening_date: z.string(),
  hashtag: z.string(),
  elf_list: z.string(),
  nudge_rate: z.string(),
  dm_rate: z.string(),
  auto_follow: z.coerce.boolean().optional(),
  send_messages: z.coerce.boolean().optional(),
});

function toData(settings: Omit<Settings, 'id'>): z.infer<typeof dataSchema> {
  return {
    ...settings,
    signups_open: Boolean(settings.signups_open),
    auto_follow: Boolean(settings.auto_follow),
    send_messages: Boolean(settings.send_messages),
  };
}

export const settings: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get('/settings', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [settings] = await Promise.all([
      db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
    ]);
    return reply.view(
      'admin/settings.ejs',
      {
        settings: toData(settings),
        oneColumn: true,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });

  app.post(
    '/settings',
    {
      schema: {
        body: dataSchema,
      },
    },
    async function (request, reply) {
      const { db, settingsChanged } = this.blueskyBridge;
      const updates: Omit<Settings, 'id'> = {
        ...request.body,
        signups_open: request.body.signups_open ? 1 : 0,
        auto_follow: request.body.auto_follow ? 1 : 0,
        send_messages: request.body.send_messages ? 1 : 0,
      };
      await db.updateTable('settings').set(updates).execute();
      await settingsChanged(updates);
      return reply.view(
        'admin/settings.ejs',
        {
          settings: toData(updates),
          oneColumn: true,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
  );
};
