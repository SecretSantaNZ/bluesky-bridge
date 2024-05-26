import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';
import { profile } from './profile.js';
import { validateAuth } from '../../util/validateAuth.js';

export const bsky: FastifyPluginAsync = async (app) => {
  const opts: FastifyPluginOptions = { prefix: '/bsky' };
  app.addHook(
    'onRequest',
    validateAuth(({ authTokenManager }) => authTokenManager)
  );
  await app.register(profile, opts);
};
