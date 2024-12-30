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
import { refreshFollowing } from './refresh-following.js';
import { bootPlayer } from './boot-player.js';
import { restorePlayer } from './restore-player.js';
import { newPlayer } from './new-player.js';

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

    // @ts-expect-error body is not typed here
    const bodyPlayerDid = request.body?.player_did;
    request.playerDid = request.tokenSubject as string;
    request.adminMode = false;
    if (request.tokenData?.admin && bodyPlayerDid) {
      request.playerDid = bodyPlayerDid;
      request.adminMode = true;
    }
  });

  app.setErrorHandler(async function (error, request, reply) {
    request.log.error(error);
    return reply.view('error.ejs');
  });

  await app.register(logout);
  await app.register(updateAddress);
  await app.register(updateGameMode);
  await app.register(refreshFollowing);
  await app.register(optOut);
  await app.register(optIn);
  await app.register(sendNudge);
  await app.register(addTracking);
  await app.register(tracking);
  await app.register(bootPlayer);
  await app.register(restorePlayer);
  await app.register(newPlayer);
};
