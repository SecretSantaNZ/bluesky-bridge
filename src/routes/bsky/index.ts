import type { FastifyPluginAsync } from 'fastify';
import { profile } from './profile.js';
import { validateAuth } from '../../util/validateAuth.js';

export const bsky: FastifyPluginAsync = async (app) => {
  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager)
  );
  await app.register(profile);
};
