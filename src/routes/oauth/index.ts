import type { FastifyPluginAsync } from 'fastify';
import { start } from './start.js';
import type { OauthPluginOptions } from './types.js';

export const oauth: FastifyPluginAsync<OauthPluginOptions> = async (
  app,
  { oauthSessionStore }
) => {
  await app.register(start, { prefix: '/oauth', oauthSessionStore });
};
