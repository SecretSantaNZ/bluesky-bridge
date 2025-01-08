import type { FastifyPluginAsync } from 'fastify';
import { matchTracking } from './match-tracking.js';

export const fragments: FastifyPluginAsync = async (app) => {
  await app.register(matchTracking);
};
