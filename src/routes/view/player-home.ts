import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { ForbiddenError, UnauthorizedError } from 'http-errors-enhanced';
import {
  queryTrackingWithGiftee,
  queryTrackingWithMatch,
} from '../../lib/database/index.js';
import type { SelectedSettings } from '../../lib/settings.js';
import type { Player } from '../../lib/PlayerService.js';
import { optOut } from './opt-out.js';
import { optIn } from './opt-in.js';
import { address } from './address.js';
import { gameMode } from './game-mode.js';
import { tracking } from './tracking.js';
import { nudge } from './nudge.js';
import { badge } from './badge.js';

export type ForcedView = {
  view:
    | 'player/booted-out'
    | 'player/opted-out'
    | 'player/address'
    | 'player/game-mode';
  clearSession: boolean;
};

/** GET requests force players to a specific view until their profile is
 *  complete: booted players are locked out, then opted-out status, address
 *  collection (except for Santa Only players), and finally game mode choice. */
export function forcedViewForPlayer(
  player: Player,
  method: string
): ForcedView | null {
  if (method !== 'GET') {
    return null;
  }
  if (player.booted) {
    return { view: 'player/booted-out', clearSession: !player.admin };
  }
  if (player.opted_out) {
    return { view: 'player/opted-out', clearSession: false };
  }
  const hasAddress = Boolean(player.address && player.address.trim());
  if (!hasAddress && player.game_mode !== 'Santa Only') {
    return { view: 'player/address', clearSession: false };
  }
  if (!player.game_mode) {
    return { view: 'player/game-mode', clearSession: false };
  }
  return null;
}

/** Builds the badge list shown on the player home: the sent-present badge
 *  once a gift has actually been sent, filtered to exclude the current-game
 *  badge and badges without images. */
export function assemblePlayerBadges(
  sentBadge: { id: number; image_url?: string | null } | undefined | null,
  giftsIveSentCount: number,
  playerBadges: Array<{ id: number; image_url: string | null | undefined }>,
  settings: { current_game_badge_id: number | null }
) {
  return [
    ...(sentBadge && giftsIveSentCount > 0 ? [sentBadge] : []),
    ...playerBadges,
  ].filter(
    (badge) => badge.id !== settings.current_game_badge_id && badge.image_url
  );
}

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
          'player.player_type',
          'player.handle',
          'player.mastodon_account',
          'player.mastodon_host',
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
          'giftee.player_type as giftee_player_type',
          'giftee.mastodon_account as giftee_mastodon_account',
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
  const badges = assemblePlayerBadges(
    sentBadge,
    giftsIveSent.length,
    playerBadges,
    settings
  );
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

/**
 * Non-GET requests from booted out or opted out players are forbidden: a
 * booted out player can take no action at all, and an opted out player may
 * only opt back in. Elves keep full access in both cases, just as an elf who
 * is booted out can continue with elf functionality.
 */
export function actionAllowedForPlayer(
  player: Pick<Player, 'admin' | 'booted' | 'opted_out'>,
  method: string,
  routeUrl: string | undefined
): boolean {
  if (method === 'GET') {
    return true;
  }
  if (player.admin) {
    return true;
  }
  if (player.booted) {
    return false;
  }
  if (player.opted_out) {
    return routeUrl === '/opt-in';
  }
  return true;
}

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

    if (
      !actionAllowedForPlayer(player, request.method, request.routeOptions.url)
    ) {
      throw new ForbiddenError();
    }

    const forced = forcedViewForPlayer(player, request.method);
    if (forced) {
      if (forced.clearSession) {
        reply.clearCookie('session');
      }
      if (forced.view === 'player/address') {
        return reply.view(forced.view, {
          CLIENT_GOOGLE_API_KEY: process.env.CLIENT_GOOGLE_API_KEY,
          hideClose: true,
        });
      }
      if (forced.view === 'player/game-mode') {
        return reply.view(forced.view, {
          hideClose: true,
          gameModeOptions: [
            { id: 'Regular', text: 'Regular' },
            { id: 'Super Santa', text: 'Super Santa' },
          ],
        });
      }
      return reply.view(forced.view);
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
