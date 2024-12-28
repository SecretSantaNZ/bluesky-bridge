import type { FastifyPluginAsync } from 'fastify';

export const adminHome: FastifyPluginAsync = async (app) => {
  app.get('/', async function (request, reply) {
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
