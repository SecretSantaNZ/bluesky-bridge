import type { FastifyPluginAsync } from 'fastify';
import { start } from './start.js';
import type { OauthPluginOptions } from './types.js';

export const oauth: FastifyPluginAsync<OauthPluginOptions> = async (
  app,
  opts
) => {
  await app.register(start, { ...opts, prefix: '/oauth' });
};
