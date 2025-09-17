import type { FastifyPluginAsync } from 'fastify';
import { validateAuth } from '../../util/validateAuth.js';
import { BadRequestError, ForbiddenError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { deleteNudge } from './delete-nudge.js';

export const nudge: FastifyPluginAsync = async (rawApp) => {
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
    const triggerId = request.headers['hx-trigger'];
    return reply.nunjucks('common/error', {
      errorMessage: error.message || 'Unknown Error',
      elementId: triggerId ? triggerId + '-error' : undefined,
    });
  });

  await app.register(deleteNudge);
};
