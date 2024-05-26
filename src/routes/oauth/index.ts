import type { FastifyPluginAsync } from 'fastify';
import { start } from './start.js';

export const oauth: FastifyPluginAsync = async (app) => {
  await app.register(start, { prefix: '/oauth' });
};
