import type { FastifyPluginAsync } from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';

export const adminHome: FastifyPluginAsync = async (app) => {
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
      csrfToken: request.tokenData?.csrfToken,
      player,
      settings,
    };
  });

  app.get('/admin', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [{ signupCompleteCount }, { registeredPlayersCount }] =
      await Promise.all([
        db
          .selectFrom('player')
          .select(({ fn }) => fn.countAll().as('signupCompleteCount'))
          .where('signup_complete', '=', 1)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('player')
          .select(({ fn }) => fn.countAll().as('registeredPlayersCount'))
          .where('deactivated', '=', 0)
          .executeTakeFirstOrThrow(),
      ]);
    return reply.view(
      'admin/home.ejs',
      { signupCompleteCount, registeredPlayersCount },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
