import type { FastifyPluginAsync } from 'fastify';
import { dm } from './dm.js';

export const action: FastifyPluginAsync = async (app) => {
  app.register(dm, { prefix: '/action' });
};
