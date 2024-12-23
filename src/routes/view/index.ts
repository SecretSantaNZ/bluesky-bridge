import { randomUUID } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import { validateAuth } from '../../util/validateAuth.js';
import type { Player } from '../../lib/PlayerService.js';

export const view: FastifyPluginAsync = async (app) => {
  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager, 'session')
  );
  app.addHook('onRequest', async function (request, reply) {
    const playerDid = request.tokenSubject as string;
    const player = await app.blueskyBridge.playerService.getPlayer(playerDid);
    if (!player) {
      throw new UnauthorizedError();
    }
    reply.locals = {
      ...reply.locals,
      csrfToken: request.tokenData?.csrfToken,
      player,
    };

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

  app.setErrorHandler(async function (error, request, reply) {
    if (error instanceof UnauthorizedError) {
      const { loginTokenManager } = this.blueskyBridge;
      const requestId = randomUUID();

      const loginToken = await loginTokenManager.generateToken(requestId, {
        returnUrl: request.url,
      });
      reply.setCookie('login-session', loginToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
      });
      reply.locals = {
        player: null,
        ...reply.locals,
      };
      return reply.view(
        'auth/login-card.ejs',
        {
          requestId,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
  });

  app.get('/', async function (request, reply) {
    const player = reply.locals?.player as Player;
    const giftees = await this.blueskyBridge.db
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
      .execute();

    const carriers = await this.blueskyBridge.db
      .selectFrom('carrier')
      .selectAll()
      .orderBy('text asc')
      .execute();

    const nudgeTypesFromDb = await this.blueskyBridge.db
      .selectFrom('nudge_type')
      .selectAll()
      .orderBy('order_index asc')
      .execute();
    const greetings = await this.blueskyBridge.db
      .selectFrom('nudge_type_greeting')
      .innerJoin(
        'nudge_greeting',
        'nudge_greeting.id',
        'nudge_type_greeting.greeting'
      )
      .selectAll()
      .orderBy('nudge_greeting.id asc')
      .execute();
    const signoffs = await this.blueskyBridge.db
      .selectFrom('nudge_type_signoff')
      .innerJoin(
        'nudge_signoff',
        'nudge_signoff.id',
        'nudge_type_signoff.signoff'
      )
      .selectAll()
      .orderBy('nudge_signoff.id asc')
      .execute();
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
      { giftees, carriers, nudgeTypes, nudgeGreetings, nudgeSignoffs },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
