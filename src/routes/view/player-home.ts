import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import plur from 'plur';
import * as dateUtils from '../../lib/dates.js';
import {
  queryTrackingWithGiftee,
  queryTrackingWithMatch,
  loadNudgeOptions,
} from '../../lib/database/index.js';
import type { SelectedSettings } from '../../lib/settings.js';

const loadPlayerHomeLocals = async (
  {
    playerService,
    db,
  }: Pick<FastifyInstance['blueskyBridge'], 'playerService' | 'db'>,
  request: FastifyRequest
) => {
  const playerDid = request.tokenSubject as string;
  const [player, settings] = await Promise.all([
    playerService.getPlayer(playerDid),
    db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
  ]);
  if (!player) {
    throw new UnauthorizedError();
  }
  return {
    admin: request.tokenData?.admin,
    csrfToken: request.tokenData?.csrfToken,
    player,
    player_display_handle:
      player.player_type === 'mastodon'
        ? player.mastodon_account
        : player.handle,
    settings,
  };
};

export const renderPlayerHome = async (
  blueskyBridge: Pick<FastifyInstance['blueskyBridge'], 'playerService' | 'db'>,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> => {
  const playerHomeLocals = await loadPlayerHomeLocals(blueskyBridge, request);
  reply.locals = {
    ...reply.locals,
    ...playerHomeLocals,
  };
  const player = playerHomeLocals.player;
  const { db, playerService } = blueskyBridge;
  const [
    giftees,
    carriers,
    myGifts,
    giftsIveSent,
    sentNudges,
    nudgeOptions,
    playerBadges,
    sentBadge,
  ] = await Promise.all([
    db
      .selectFrom('match')
      .innerJoin('player', 'player.id', 'match.giftee')
      .select([
        'player.avatar_url',
        'player.handle',
        'player.address',
        'player.delivery_instructions',
        'match.id as match_id',
        'match.match_status',
        'match.nudge_count',
        'match.tracking_count',
      ])
      .where('match.santa', '=', player.id)
      .where('match.deactivated', 'is', null)
      .where('match.match_status', '<>', 'draft')
      .execute(),
    db.selectFrom('carrier').selectAll().orderBy('id', 'asc').execute(),
    queryTrackingWithMatch(db)
      .where('match.giftee', '=', player.id)
      .orderBy('shipped_date', 'asc')
      .execute(),
    queryTrackingWithGiftee(db)
      .where('match.santa', '=', player.id)
      .orderBy('shipped_date', 'asc')
      .execute(),
    db
      .selectFrom('nudge')
      .innerJoin('match', 'match.id', 'nudge.match')
      .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
      .innerJoin('nudge_type', 'nudge_type.id', 'nudge.nudge_type')
      .select([
        'nudge_type.name as nudge_type',
        'nudge.created_at',
        'giftee.handle as giftee_handle',
        'nudge.post_url',
      ])
      .where('match.santa', '=', player.id)
      .orderBy('nudge.created_at', 'asc')
      .execute(),
    loadNudgeOptions(db),
    db
      .selectFrom('player_badge')
      .innerJoin('badge', 'badge.id', 'player_badge.badge_id')
      .select([
        'badge.id',
        'badge.title',
        'badge.description',
        'badge.image_url',
      ])
      .where('player_badge.player_did', '=', player.did)
      .orderBy('recorded_at', 'asc')
      .execute(),
    db
      .selectFrom('badge')
      .innerJoin('settings', 'settings.sent_present_badge_id', 'badge.id')
      .select([
        'badge.id',
        'badge.title',
        'badge.description',
        'badge.image_url',
      ])
      .executeTakeFirst(),
  ]);

  const settings = reply.locals?.settings as SelectedSettings;
  const badges = [
    ...(sentBadge && giftsIveSent.length > 0 ? [sentBadge] : []),
    ...playerBadges,
  ].filter((badge) => badge.id !== settings.current_game_badge_id);
  return reply.view(
    'player/home.ejs',
    {
      ...dateUtils,
      ...nudgeOptions,
      plur,
      giftees,
      carriers,
      myGifts,
      giftsIveSent,
      sentNudges,
      santaMastodonHandle: playerService.santaMastodonHandle,
      santaMastodonUsername: playerService.santaMastodonHandle.split('@')[0],
      santaMastodonHost: playerService.santaMastodonHost,
      badges,
    },
    {
      layout: 'layouts/base-layout.ejs',
    }
  );
};

export const playerHome: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async function (request, reply) {
    const playerHomeLocals = await loadPlayerHomeLocals(
      this.blueskyBridge,
      request
    );
    reply.locals = {
      ...reply.locals,
      ...playerHomeLocals,
    };
    const player = playerHomeLocals.player;

    if (player.booted) {
      if (!player.admin) {
        reply.clearCookie('session');
      }
      return reply.view(
        'player/booted-out-card.ejs',
        { hideClose: true },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
    if (player.opted_out) {
      return reply.view(
        'player/opted-out-card.ejs',
        { hideClose: true },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
    const hasAddress = Boolean(player.address && player.address.trim());
    if (!hasAddress) {
      return reply.nunjucks('player/address-page', { hideClose: true });
    }
    if (!player.game_mode) {
      return reply.view(
        'player/game-mode-card.ejs',
        { hideClose: true },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
  });

  app.get('/', async function (request, reply) {
    return renderPlayerHome(this.blueskyBridge, request, reply);
  });
};
