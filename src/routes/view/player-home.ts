import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import type { Player } from '../../lib/PlayerService.js';
import * as dateUtils from '../../lib/dates.js';
import {
  queryTrackingWithGiftee,
  queryTrackingWithMatch,
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
    const [
      giftees,
      carriers,
      nudgeTypesFromDb,
      greetings,
      signoffs,
      myGifts,
      giftsIveSent,
    ] = await Promise.all([
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
      this.blueskyBridge.db
        .selectFrom('nudge_type')
        .selectAll()
        .orderBy('order_index asc')
        .execute(),
      this.blueskyBridge.db
        .selectFrom('nudge_type_greeting')
        .innerJoin(
          'nudge_greeting',
          'nudge_greeting.id',
          'nudge_type_greeting.greeting'
        )
        .selectAll()
        .orderBy('nudge_greeting.id asc')
        .execute(),
      this.blueskyBridge.db
        .selectFrom('nudge_type_signoff')
        .innerJoin(
          'nudge_signoff',
          'nudge_signoff.id',
          'nudge_type_signoff.signoff'
        )
        .selectAll()
        .orderBy('nudge_signoff.id asc')
        .execute(),
      queryTrackingWithMatch(this.blueskyBridge.db)
        .where('match.giftee', '=', player.id)
        .orderBy('shipped_date asc')
        .execute(),
      queryTrackingWithGiftee(this.blueskyBridge.db)
        .where('match.santa', '=', player.id)
        .orderBy('shipped_date asc')
        .execute(),
    ]);
    const nudgeGreetings: Record<
      string,
      Array<{ id: number; text: string }>
    > = {};
    const nudgeSignoffs: Record<
      string,
      Array<{ id: number; text: string }>
    > = {};
    const nudgeTypes = nudgeTypesFromDb.map((nudgeType) => ({
      id: String(nudgeType.id),
      text: nudgeType.name,
    }));
    nudgeTypesFromDb.forEach((nudgeType) => {
      nudgeGreetings[String(nudgeType.id)] = greetings
        .filter((row) => row.nudge_type === nudgeType.id)
        .map((row) => ({
          id: row.id,
          text: row.text,
        }));
      nudgeSignoffs[String(nudgeType.id)] = signoffs
        .filter((row) => row.nudge_type === nudgeType.id)
        .map((row) => ({
          id: row.id,
          text: row.text,
        }));
    });
    return reply.view(
      'player/home.ejs',
      {
        ...dateUtils,
        giftees,
        carriers,
        nudgeTypes,
        nudgeGreetings,
        nudgeSignoffs,
        myGifts,
        giftsIveSent,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
