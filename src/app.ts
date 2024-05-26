import type * as http from 'http';
import fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import fastifyHttpErrorsEnhanced from 'fastify-http-errors-enhanced';
import fastifyFormBody from '@fastify/formbody';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import path from 'path';

import type { OauthSessionStore } from './lib/oauth.js';
import type { TokenManager } from './lib/TokenManager.js';

import { action } from './routes/action/index.js';
import { oauth } from './routes/oauth/index.js';
import { bsky } from './routes/bsky/index.js';

declare module 'fastify' {
  export interface FastifyInstance {
    blueskyBridge: {
      oauthSessionStore: OauthSessionStore;
      loginTokenManager: TokenManager;
      authTokenManager: TokenManager;
    };
  }

  export interface FastifyRequest {
    tokenSubject?: string;
  }
}

export const build = async (
  opts: fastify.FastifyHttpOptions<http.Server>,
  blueskyBridge: {
    oauthSessionStore: OauthSessionStore;
    loginTokenManager: TokenManager;
    authTokenManager: TokenManager;
  }
) => {
  const app = fastify(opts);
  app.decorate('blueskyBridge', blueskyBridge);
  app.decorateRequest('tokenSubject');

  await app.register(fastifyFormBody);
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
  await app.register(bsky);

  return app;
};
