import type { FastifyPluginAsync } from 'fastify';
import fastifyBasicAuth from '@fastify/basic-auth';

import { start } from './start.js';
import { poll } from './poll.js';
import { token } from './token.js';
import { UnauthorizedError } from 'http-errors-enhanced';

export const oauth: FastifyPluginAsync = async (app) => {
  await app.register(fastifyBasicAuth, {
    validate: async function validate(username, password, req) {
      if (
        await this.blueskyBridge.oauthSessionStore.authenticateClient(
          username,
          password
        )
      ) {
        req.tokenSubject = username;
      } else {
        throw new UnauthorizedError('Unknown client');
      }
    },
  });

  await app.register(start);
  await app.register(poll);
  await app.register(token);
};
