import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import {
  queryTrackingWithGiftee,
  queryTrackingWithMatch,
} from '../../lib/database/index.js';
import type { SelectedSettings } from '../../lib/settings.js';
import { optOut } from './opt-out.js';
import { optIn } from './opt-in.js';
import { address } from './address.js';
import { gameMode } from './game-mode.js';
import { tracking } from './tracking.js';
import { nudge } from './nudge.js';
import { badge } from './badge.js';

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
  reply: FastifyReply,
  view = 'player/home'
): Promise<FastifyReply> => {
  const playerHomeLocals = await loadPlayerHomeLocals(blueskyBridge, request);
  reply.locals = {
    ...reply.locals,
    ...playerHomeLocals,
  };
  const player = playerHomeLocals.player;
  const { db, playerService } = blueskyBridge;
  const [giftees, myGifts, giftsIveSent, sentNudges, playerBadges, sentBadge] =
    await Promise.all([
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
  return reply.view(view, {
    giftees,
    myGifts,
    giftsIveSent,
    sentNudges,
    santaMastodonHandle: playerService.santaMastodonHandle,
    santaMastodonUsername: playerService.santaMastodonHandle.split('@')[0],
    santaMastodonHost: playerService.santaMastodonHost,
    badges,
  });
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

    if (request.method === 'GET') {
      if (player.booted) {
        if (!player.admin) {
          reply.clearCookie('session');
        }
        return reply.view('player/booted-out');
      }
      if (player.opted_out) {
        reply.locals = {
          ...reply.locals,
        };
        return reply.view('player/opted-out');
      }
      const hasAddress = Boolean(player.address && player.address.trim());
      if (!hasAddress) {
        return reply.view('player/address', { hideClose: true });
      }
      if (!player.game_mode) {
        return reply.view('player/game-mode', {
          hideClose: true,
          gameModeOptions: [
            { id: 'Regular', text: 'Regular' },
            { id: 'Super Santa', text: 'Super Santa' },
          ],
        });
      }
    }
  });

  await app.register(optOut);
  await app.register(optIn);
  await app.register(address);
  await app.register(gameMode);
  await app.register(tracking);
  await app.register(nudge);
  await app.register(badge);

  app.get('/', async function (request, reply) {
    return renderPlayerHome(this.blueskyBridge, request, reply);
  });
};
