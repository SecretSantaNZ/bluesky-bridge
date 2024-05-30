import type { FastifyPluginAsync } from 'fastify';
import { dm } from './dm.js';
import fastifyBasicAuth from '@fastify/basic-auth';
import { UnauthorizedError } from 'http-errors-enhanced';
import bcrypt from 'bcrypt';
import { templateDm } from './template-dm.js';
import { nudge } from './nudge.js';

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

  await app.register(dm);
  await app.register(templateDm);
  await app.register(nudge);
};
