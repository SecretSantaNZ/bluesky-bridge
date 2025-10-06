import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError } from 'http-errors-enhanced';
import { baseAdminPlayerQuery } from '../manage-players.js';

export const badges: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/badges',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
      },
    },
    async function (request, reply) {
      const playerId = request.params.player_id;
      const { db, playerService } = this.blueskyBridge;
      const [player, playerBadges, badges, adminPlayer] = await Promise.all([
        playerService.getPlayerById(playerId),
        db
          .selectFrom('player_badge')
          .innerJoin('badge', 'badge.id', 'player_badge.badge_id')
          .innerJoin('player', 'player.did', 'player_badge.player_did')
          .select([
            'badge.id',
            'badge.title',
            'badge.description',
            'badge.image_url',
          ])
          .where('player.id', '=', playerId)
          .orderBy('recorded_at', 'asc')
          .execute(),
        db
          .selectFrom('badge')
          .select(['badge.id', 'badge.title'])
          .orderBy('badge.id', 'desc')
          .execute(),
        baseAdminPlayerQuery(db)
          .where('player.id', '=', playerId)
          .executeTakeFirstOrThrow(),
      ]);
      if (player == null) {
        throw new NotFoundError();
      }

      return reply.nunjucks('admin/player/badges', {
        playerBadges,
        badges: badges.filter(
          (badge) => !playerBadges.find((pb) => pb.id === badge.id)
        ),
        csrfToken: request.tokenData?.csrfToken,
        player,
        player_display_handle:
          player.player_type === 'mastodon'
            ? player.mastodon_account
            : player.handle,
        playerEvents: [
          {
            updated: adminPlayer,
          },
        ],
      });
    }
  );

  app.post(
    '/badges',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
        }),
        body: z.object({
          badge_id: z.coerce.number(),
        }),
      },
    },
    async function (request, reply) {
      const { db, playerService } = this.blueskyBridge;
      const player = await playerService.getPlayerById(
        request.params.player_id
      );
      if (player == null) {
        throw new NotFoundError('Player not found');
      }
      await db
        .insertInto('player_badge')
        .values({
          player_did: player.did,
          badge_id: request.body.badge_id,
          recorded_at: new Date().toISOString(),
        })
        .execute();
      return reply.redirect(`/admin/player/${player.id}/badges`, 303);
    }
  );

  app.post(
    '/badges/:badge_id/delete',
    {
      schema: {
        params: z.object({
          player_id: z.coerce.number(),
          badge_id: z.coerce.number(),
        }),
      },
    },
    async function (request, reply) {
      const { db, playerService } = this.blueskyBridge;
      const player = await playerService.getPlayerById(
        request.params.player_id
      );
      if (player == null) {
        throw new NotFoundError('Player not found');
      }
      await db
        .deleteFrom('player_badge')
        .where('player_did', '=', player.did)
        .where('badge_id', '=', request.params.badge_id)
        .execute();

      return reply.redirect(`/admin/player/${player.id}/badges`, 303);
    }
  );
};
