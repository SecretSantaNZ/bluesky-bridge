import type { FastifyPluginAsync, FastifyPluginOptions } from 'fastify';

import { start } from './start.js';
import { poll } from './poll.js';
import { token } from './token.js';

export const oauth: FastifyPluginAsync = async (app) => {
  const opts: FastifyPluginOptions = { prefix: '/oauth' };
  await app.register(start, opts);
  await app.register(poll, opts);
  await app.register(token, opts);
};
