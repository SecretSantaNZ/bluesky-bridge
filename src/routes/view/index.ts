import { randomUUID } from 'crypto';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
} from 'fastify';
import { UnauthorizedError } from 'http-errors-enhanced';
import { validateAuth } from '../../util/validateAuth.js';
import { playerHome } from './player-home.js';
import { admin } from './admin/index.js';

export async function returnLoginView(
  blueskyBridge: Pick<
    FastifyInstance['blueskyBridge'],
    'db' | 'returnTokenManager'
  >,
  reply: FastifyReply,
  returnUrl: string,
  locals: Record<string, unknown> = {}
) {
  const { returnTokenManager, db } = blueskyBridge;
  const requestId = randomUUID();

  const returnToken = await returnTokenManager.generateToken(requestId, {
    returnUrl,
  });
  const settings = await db
    .selectFrom('settings')
    .selectAll()
    .executeTakeFirstOrThrow();
  reply.locals = {
    ...locals,
    player: null,
    settings,
    ...reply.locals,
  };
  return reply.view(
    'auth/login-card.ejs',
    {
      requestId,
      returnToken,
      replaceUrl: returnUrl,
    },
    {
      layout: 'layouts/base-layout.ejs',
    }
  );
}

export const view: FastifyPluginAsync = async (app) => {
  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager, 'session')
  );

  app.setErrorHandler(async function (error, request, reply) {
    if (error instanceof UnauthorizedError) {
      return await returnLoginView(this.blueskyBridge, reply, request.url, {
        handle: error.handle,
      });
    }
    request.log.error(error);
  });

  await app.register(playerHome);
  await app.register(admin, { prefix: '/admin' });
};
