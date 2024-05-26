import type * as http from 'http';
import fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import fastifyHttpErrorsEnhanced from 'fastify-http-errors-enhanced';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import path from 'path';

import type { OauthSessionStore } from './lib/oauth.js';
import type { LoginTokenManager } from './lib/LoginTokenManager.js';

import { action } from './routes/action/index.js';
import { oauth } from './routes/oauth/index.js';

declare module 'fastify' {
  export interface FastifyInstance {
    blueskyBridge: {
      oauthSessionStore: OauthSessionStore;
      loginTokenManager: LoginTokenManager;
    };
  }
}

export const build = async (
  opts: fastify.FastifyHttpOptions<http.Server>,
  blueskyBridge: {
    oauthSessionStore: OauthSessionStore;
    loginTokenManager: LoginTokenManager;
  }
) => {
  const app = fastify(opts);
  app.decorate('blueskyBridge', blueskyBridge);

  await app.register(fastifyHttpErrorsEnhanced);
  await app.register(fastifyView, {
    engine: {
      ejs,
    },
    root: path.join(new URL('.', import.meta.url).pathname, 'views'),
  });

  // Add schema validator and serializer
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(action);
  await app.register(oauth);

  return app;
};
