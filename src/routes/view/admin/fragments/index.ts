import type { FastifyPluginAsync } from 'fastify';
import { matchTracking } from './match-tracking.js';
import { matchNudges } from './match-nudges.js';

export const fragments: FastifyPluginAsync = async (app) => {
  await app.register(matchTracking);
  await app.register(matchNudges);
};
