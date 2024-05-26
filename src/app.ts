import type * as http from 'http';
import fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import fastifyHttpErrorsEnhanced from 'fastify-http-errors-enhanced';

import { action } from './routes/action/index.js';
import { oauth } from './routes/oauth/index.js';
import type { OauthSessionStore } from './lib/oauth.js';

export const build = async ({
  oauthSessionStore,
  ...opts
}: fastify.FastifyHttpOptions<http.Server> & {
  oauthSessionStore: OauthSessionStore;
}) => {
  const app = fastify(opts);

  await app.register(fastifyHttpErrorsEnhanced);

  // Add schema validator and serializer
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(action);
  await app.register(oauth, { oauthSessionStore });

  return app;
};
