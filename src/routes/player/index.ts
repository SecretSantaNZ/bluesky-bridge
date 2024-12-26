import type { FastifyPluginAsync } from 'fastify';
import { validateAuth } from '../../util/validateAuth.js';
import { BadRequestError } from 'http-errors-enhanced';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { updateAddress } from './update-address.js';
import { updateGameMode } from './update-game-mode.js';
import { optIn } from './opt-in.js';
import { optOut } from './opt-out.js';
import { sendNudge } from './send-nudge.js';
import { addTracking } from './add-tracking.js';
import { tracking } from './tracking.js';
import { logout } from './logout.js';

export const player: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager, 'session')
  );

  app.addHook('preValidation', async function (request) {
    if (request.method === 'GET') return;
    if (request.method === 'OPTIONS') return;
    // @ts-expect-error body and query are not typed here
    const csrfToken = request.query?.csrfToken || request.body?.csrfToken;
    if (csrfToken !== request.tokenData?.csrfToken || !csrfToken) {
      throw new BadRequestError('invalid csrf token');
    }
  });

  app.setErrorHandler(async function (error, request, reply) {
    return reply.view('error.ejs');
  });

  await app.register(logout);
  await app.register(updateAddress);
  await app.register(updateGameMode);
  await app.register(optOut);
  await app.register(optIn);
  await app.register(sendNudge);
  await app.register(addTracking);
  await app.register(tracking);
};
