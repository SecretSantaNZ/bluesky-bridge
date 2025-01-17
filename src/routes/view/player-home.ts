import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import plur from 'plur';
import type { Player } from '../../lib/PlayerService.js';
import * as dateUtils from '../../lib/dates.js';
import {
  queryTrackingWithGiftee,
  queryTrackingWithMatch,
  loadNudgeOptions,
} from '../../lib/database/index.js';

export const playerHome: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async function (request, reply) {
    const playerDid = request.tokenSubject as string;
    const [player, settings] = await Promise.all([
      app.blueskyBridge.playerService.getPlayer(playerDid),
      this.blueskyBridge.db
        .selectFrom('settings')
        .selectAll()
        .executeTakeFirstOrThrow(),
    ]);
    if (!player) {
      throw new UnauthorizedError();
    }
    reply.locals = {
      ...reply.locals,
      admin: request.tokenData?.admin,
      csrfToken: request.tokenData?.csrfToken,
      player,
      settings,
    };

    if (player.booted) {
      return reply.clearCookie('session').view(
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
      return reply.view(
        'player/address-card.ejs',
        { hideClose: true },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
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
    const player = reply.locals?.player as Player;
    const [giftees, carriers, myGifts, giftsIveSent, sentNudges, nudgeOptions] =
      await Promise.all([
        this.blueskyBridge.db
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
        this.blueskyBridge.db
          .selectFrom('carrier')
          .selectAll()
          .orderBy('id asc')
          .execute(),
        queryTrackingWithMatch(this.blueskyBridge.db)
          .where('match.giftee', '=', player.id)
          .orderBy('shipped_date asc')
          .execute(),
        queryTrackingWithGiftee(this.blueskyBridge.db)
          .where('match.santa', '=', player.id)
          .orderBy('shipped_date asc')
          .execute(),
        this.blueskyBridge.db
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
          .orderBy('nudge.created_at asc')
          .execute(),
        loadNudgeOptions(this.blueskyBridge.db),
      ]);
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
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
