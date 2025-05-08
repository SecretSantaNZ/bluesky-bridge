import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SelectedSettings } from '../../../lib/settings.js';

const dataSchema = z.object({
  signups_open: z.coerce.boolean().optional(),
  mastodon_players: z.coerce.boolean().optional(),
  matches_sent_date: z.string(),
  signups_open_date: z.string(),
  signups_close_date: z.string(),
  send_by_date: z.string(),
  opening_date: z.string(),
  hashtag: z.string(),
  feed_hashtags: z.string(),
  elf_list: z.string(),
  nudge_rate: z.string(),
  dm_rate: z.string(),
  auto_follow: z.coerce.boolean().optional(),
  send_messages: z.coerce.boolean().optional(),
  feed_player_only: z.coerce.boolean().optional(),
  feed_max_distance_from_tag: z.coerce.number(),
  show_badges: z.coerce.boolean().optional(),
});

function toData(
  settings: Omit<
    SelectedSettings,
    | 'id'
    | 'current_game_badge_id'
    | 'sent_present_badge_id'
    | 'super_santa_badge_id'
  >
): z.infer<typeof dataSchema> {
  return {
    ...settings,
    signups_open: Boolean(settings.signups_open),
    mastodon_players: Boolean(settings.mastodon_players),
    auto_follow: Boolean(settings.auto_follow),
    send_messages: Boolean(settings.send_messages),
    feed_player_only: Boolean(settings.feed_player_only),
    show_badges: Boolean(settings.show_badges),
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
      const updates: Omit<
        SelectedSettings,
        | 'id'
        | 'current_game_badge_id'
        | 'sent_present_badge_id'
        | 'super_santa_badge_id'
      > = {
        ...request.body,
        signups_open: request.body.signups_open ? 1 : 0,
        mastodon_players: request.body.mastodon_players ? 1 : 0,
        auto_follow: request.body.auto_follow ? 1 : 0,
        send_messages: request.body.send_messages ? 1 : 0,
        feed_player_only: request.body.feed_player_only ? 1 : 0,
        show_badges: request.body.show_badges ? 1 : 0,
      };
      await db.updateTable('settings').set(updates).execute();
      await settingsChanged(updates);
      return reply.view(
        'admin/settings.ejs',
        {
          settings: toData(updates),
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
  );

  app.post(
    '/settings/reset-game',
    {
      schema: {
        body: z.object({}),
      },
    },
    async function (request, reply) {
      const { playerService } = this.blueskyBridge;

      await playerService.resetEverything();

      return reply.code(204).send();
    }
  );
};
