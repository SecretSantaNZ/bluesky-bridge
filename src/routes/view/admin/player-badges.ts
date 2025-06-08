import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from 'http-errors-enhanced';
import { z } from 'zod';

export const renderPlayerBadges = async (
  {
    db,
    playerService,
  }: Pick<FastifyInstance['blueskyBridge'], 'db' | 'playerService'>,
  player_did: string,
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const [player, playerBadges, badges] = await Promise.all([
    playerService.getPlayer(player_did),
    db
      .selectFrom('player_badge')
      .innerJoin('badge', 'badge.id', 'player_badge.badge_id')
      .select([
        'badge.id',
        'badge.title',
        'badge.description',
        'badge.image_url',
      ])
      .where('player_badge.player_did', '=', player_did)
      .orderBy('recorded_at', 'asc')
      .execute(),
    db
      .selectFrom('badge')
      .select(['badge.id', 'badge.title'])
      .orderBy('badge.id', 'desc')
      .execute(),
  ]);
  if (player == null) {
    throw new NotFoundError();
  }

  return reply.view(
    'admin/player-badges.ejs',
    {
      playerBadges,
      badges: badges.filter(
        (badge) => !playerBadges.find((pb) => pb.id === badge.id)
      ),
      csrfToken: request.tokenData?.csrfToken,
      player_did,

      player_display_handle:
        player.player_type === 'mastodon'
          ? player.mastodon_account
          : player.handle,
    },
    {
      layout: 'layouts/base-layout.ejs',
    }
  );
};

export const playerBadges: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/player-badges',
    {
      schema: {
        querystring: z.object({
          player_did: z.string(),
        }),
      },
    },
    async function (request, reply) {
      return renderPlayerBadges(
        this.blueskyBridge,
        request.query.player_did,
        request,
        reply
      );
    }
  );

  app.post(
    '/player-badges',
    {
      schema: {
        body: z.object({
          player_did: z.string(),
          badge_id: z.coerce.number(),
        }),
      },
    },
    async function (request, reply) {
      const { db } = this.blueskyBridge;
      await db
        .insertInto('player_badge')
        .values({
          player_did: request.body.player_did,
          badge_id: request.body.badge_id,
          recorded_at: new Date().toISOString(),
        })
        .execute();
      return renderPlayerBadges(
        this.blueskyBridge,
        request.body.player_did,
        request,
        reply
      );
    }
  );

  app.delete(
    '/player-badges',
    {
      schema: {
        querystring: z.object({
          player_did: z.string(),
          badge_id: z.coerce.number(),
        }),
      },
    },
    async function (request, reply) {
      const { db } = this.blueskyBridge;
      await db
        .deleteFrom('player_badge')
        .where('player_did', '=', request.query.player_did)
        .where('badge_id', '=', request.query.badge_id)
        .execute();
      return renderPlayerBadges(
        this.blueskyBridge,
        request.query.player_did,
        request,
        reply
      );
    }
  );
};
