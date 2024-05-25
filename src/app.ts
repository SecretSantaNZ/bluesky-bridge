import type * as http from 'http';
import fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { action } from './routes/action/index.js';

export const build = (opts: fastify.FastifyHttpOptions<http.Server> = {}) => {
  const app = fastify(opts);

  // Add schema validator and serializer
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(action);

  return app;
};
