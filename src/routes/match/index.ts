import type { FastifyPluginAsync } from 'fastify';
import { validateAuth } from '../../util/validateAuth.js';
import { BadRequestError, ForbiddenError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { deactivateMatch } from './deactivate-match.js';
import { reassignGiftee } from './reassign-giftee.js';
import { publish } from './publish.js';
import { autoMatch } from './autoMatch.js';
import { markContacted } from './mark-contacted.js';
import { markSorted } from './mark-sorted.js';

export const match: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager, 'session')
  );

  app.addHook('preValidation', async function (request) {
    if (!request.tokenData?.admin) {
      throw new ForbiddenError();
    }
    if (request.method === 'GET') return;
    if (request.method === 'OPTIONS') return;
    // @ts-expect-error body and query are not typed here
    const csrfToken = request.query?.csrfToken || request.body?.csrfToken;
    if (csrfToken !== request.tokenData?.csrfToken || !csrfToken) {
      throw new BadRequestError('invalid csrf token');
    }
  });

  app.setErrorHandler(async function (error, request, reply) {
    request.log.error(error);
    return reply.view('error.ejs');
  });

  await app.register(deactivateMatch);
  await app.register(reassignGiftee);
  await app.register(publish);
  await app.register(autoMatch);
  await app.register(markContacted);
  await app.register(markSorted);
};
