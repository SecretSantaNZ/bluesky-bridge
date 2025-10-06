import type { FastifyPluginAsync } from 'fastify';
import {
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
} from 'http-errors-enhanced';
import { adminHome } from './home.js';
import { managePlayers } from './manage-players.js';
import { fixMatches } from './fix-matches.js';
import { draftMatches } from './draft-matches.js';
import { publishedMatches } from './published-matches.js';
import { nudges } from './nudges.js';
import { badges } from './badges.js';
import { tracking } from './tracking.js';
import { withoutGifts } from './without-gifts.js';
import { hasntPosted } from './hasnt-posted.js';
import { settings } from './settings.js';
import { player } from './player/index.js';
import { fragments } from './fragments/index.js';

export const admin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async function (request, reply) {
    if (!request.tokenData?.admin) {
      if (request.method === 'GET') {
        return reply.redirect('/', 303);
      }
      throw new ForbiddenError();
    }
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
  });

  app.addHook('preValidation', async function (request) {
    if (request.method === 'GET') return;
    if (request.method === 'OPTIONS') return;
    // @ts-expect-error body and query are not typed here
    const csrfToken = request.query?.csrfToken || request.body?.csrfToken;
    if (csrfToken !== request.tokenData?.csrfToken || !csrfToken) {
      throw new BadRequestError('invalid csrf token');
    }
  });

  await app.register(adminHome);
  await app.register(managePlayers);
  await app.register(draftMatches);
  await app.register(fixMatches);
  await app.register(publishedMatches);
  await app.register(nudges);
  await app.register(badges);
  await app.register(tracking);
  await app.register(withoutGifts);
  await app.register(hasntPosted);
  await app.register(settings);
  await app.register(player, { prefix: '/player' });
  await app.register(fragments, { prefix: '/fragments' });
};
