import dotenv from 'dotenv';
import Fastify from 'fastify';
import basicAuth from '@fastify/basic-auth';

dotenv.config();

const fastify = Fastify({
  logger: true,
});

fastify.register(basicAuth, {
  validate: async (username, password) => {
    if (username !== 'Tyrion' || password !== 'wine') {
      return new Error('Winter is coming');
    }
  },
  authenticate: { realm: 'Westeros' },
});

fastify.after(() => {
  fastify.addHook('onRequest', fastify.basicAuth);
});

// Declare a route
fastify.get('/', async (request, reply) => {
  await new Promise((resolve) => setTimeout(() => resolve(undefined), 3000));
  reply.send({ hello: 'world' });
});

// Run the server!
fastify.listen({ port: 3000 }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`Server is now listening on ${address}`);
});
