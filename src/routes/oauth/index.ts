import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';

import { start } from './start.js';
import { poll } from './poll.js';

export const oauth: FastifyPluginAsync = async (app) => {
  app.decorateRequest('postKey');

  const opts: FastifyPluginOptions = { prefix: '/oauth' };
  await app.register(start, opts);
  await app.register(poll, opts);
};
