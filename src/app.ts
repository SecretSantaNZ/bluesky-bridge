import type * as http from 'http';
import fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import fastifyHttpErrorsEnhanced from 'fastify-http-errors-enhanced';
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

  // Add schema validator and serializer
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(action);
  await app.register(oauth);

  return app;
};
