import type { FastifyPluginAsync } from 'fastify';
import fastifyBasicAuth from '@fastify/basic-auth';
import { UnauthorizedError } from 'http-errors-enhanced';
import bcrypt from 'bcrypt';
import { player } from './player.js';
import { settings } from './settings.js';

export const sync: FastifyPluginAsync = async (app) => {
  await app.register(fastifyBasicAuth, {
    validate: async function validate(username, password, req) {
      if (
        username === process.env.SYNC_USERNAME &&
        (await bcrypt.compare(
          password,
          process.env.SYNC_PASSWORD_HASH as string
        ))
      ) {
        req.tokenSubject = username;
      } else {
        throw new UnauthorizedError();
      }
    },
  });

  app.addHook('onRequest', app.basicAuth);

  await app.register(player);
  await app.register(settings);
};
