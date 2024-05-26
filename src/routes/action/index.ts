import type { FastifyPluginAsync } from 'fastify';
import { dm } from './dm.js';
import fastifyBasicAuth from '@fastify/basic-auth';
import { UnauthorizedError } from 'http-errors-enhanced';
import bcrypt from 'bcrypt';

export const action: FastifyPluginAsync = async (app) => {
  await app.register(fastifyBasicAuth, {
    validate: async function validate(username, password, req) {
      if (
        username === process.env.ACTION_USERNAME &&
        (await bcrypt.compare(
          password,
          process.env.ACTION_PASSWORD_HASH as string
        ))
      ) {
        req.tokenSubject = username;
      } else {
        throw new UnauthorizedError();
      }
    },
  });

  app.addHook('onRequest', app.basicAuth);

  await app.register(dm, { prefix: '/action' });
};
