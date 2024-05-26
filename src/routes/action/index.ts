import type { FastifyPluginAsync } from 'fastify';
import { dm } from './dm.js';

export const action: FastifyPluginAsync = async (app) => {
  await app.register(dm, { prefix: '/action' });
};
