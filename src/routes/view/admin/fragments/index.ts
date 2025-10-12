import type { FastifyPluginAsync } from 'fastify';
import { playerNotes } from './player-notes.js';

export const fragments: FastifyPluginAsync = async (app) => {
  await app.register(playerNotes);
};
