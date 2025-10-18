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
  if (locals.errorMessage) {
    reply.status(400);
  } else {
    reply.status(401);
  }
  return reply.view('auth/login', {
    requestId,
    returnToken,
    replaceUrl: returnUrl,
  });
}

export const view: FastifyPluginAsync = async (app) => {
  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager, 'session')
  );

  app.addHook('preHandler', async function (request, reply) {
    if (request.method === 'GET') {
      reply.locals = {
        ...reply.locals,
        CLIENT_GOOGLE_API_KEY: process.env.CLIENT_GOOGLE_API_KEY,
      };
    }
  });

  app.setErrorHandler(async function (error, request, reply) {
    if (error instanceof UnauthorizedError) {
      return await returnLoginView(this.blueskyBridge, reply, request.url, {
        handle: error.handle,
      });
    }
    request.log.error(error);

    const elementId =
      request.headers['x-ssnz-error-target'] ??
      (request.headers['x-alpine-target'] as string | undefined)?.split(
        ' '
      )[0] ??
      undefined;

    // @ts-expect-error can't be bothered typing to http error
    return reply.status(error.status ?? 500).view('common/error', {
      errorMessage: error.message || 'Unknown Error',
      elementId,
    });
  });

  await app.register(playerHome);
  await app.register(admin, { prefix: '/admin' });
};
