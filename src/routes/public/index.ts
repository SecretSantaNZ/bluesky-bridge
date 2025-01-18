import type { FastifyPluginAsync } from 'fastify';
import * as dateUtils from '../../lib/dates.js';
import { validateAuth } from '../../util/validateAuth.js';
import { UnauthorizedError } from 'http-errors-enhanced';

export const publicContent: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async function (request) {
    try {
      await validateAuth(
        ({ authTokenManager }) => authTokenManager,
        'session'
      ).bind(this)(request);
    } catch (e) {
      // we ignore unauthorized errors as these pages are public so user is allowed
      // to be not logged in
      if (!(e instanceof UnauthorizedError)) {
        throw e;
      }
    }
  });

  app.addHook('preValidation', async function (request, reply) {
    const playerDid = request.tokenSubject;
    const [player, settings] = await Promise.all([
      playerDid == null
        ? undefined
        : app.blueskyBridge.playerService.getPlayer(playerDid),
      this.blueskyBridge.db
        .selectFrom('settings')
        .selectAll()
        .executeTakeFirstOrThrow(),
    ]);

    reply.locals = {
      ...reply.locals,
      ...dateUtils,
      csrfToken: request.tokenData?.csrfToken,
      player,
      settings,
    };
  });

  app.get('/faq', async function (request, reply) {
    return reply.view(
      'public/faq.ejs',
      {
        oneColumn: true,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });

  app.get('/rules', async function (request, reply) {
    return reply.view(
      'public/rules.ejs',
      {
        oneColumn: true,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
