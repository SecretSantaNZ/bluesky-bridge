import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import { adminHome } from './home.js';
import { managePlayers } from './manage-players.js';
import { fixMatches } from './fix-matches.js';
import { draftMatches } from './draft-matches.js';
import { publishedMatches } from './published-matches.js';

export const admin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async function (request, reply) {
    if (!request.tokenData?.admin) {
      return reply.redirect(303, '/');
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

  await app.register(adminHome);
  await app.register(managePlayers);
  await app.register(draftMatches);
  await app.register(fixMatches);
  await app.register(publishedMatches);
};
