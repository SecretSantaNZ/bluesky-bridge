import type { FastifyPluginAsync } from 'fastify';
import { matchTracking } from './match-tracking.js';
import { matchNudges } from './match-nudges.js';
import { playerNotes } from './player-notes.js';

export const fragments: FastifyPluginAsync = async (app) => {
  await app.register(matchTracking);
  await app.register(matchNudges);
  await app.register(playerNotes);
};
