import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const meta: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get('/dm/types', async function (request, reply) {
    const result = await this.blueskyBridge.db
      .selectFrom('message')
      .select('message_type')
      .distinct()
      .execute();

    const types = result
      .filter(({ message_type }) => message_type.startsWith('dm-'))
      .map(({ message_type }) => message_type.substring(3));
    reply.send({ types });
  });

  app.get(
    '/dm/variables',
    {
      schema: {
        querystring: z.object({
          message_type: z.string().optional(),
        }),
      },
    },
    async function (request, reply) {
      const result = await this.blueskyBridge.db
        .selectFrom('message')
        .select('message')
        .where('message_type', '=', 'dm-' + request.query.message_type)
        .execute();

      const uniqueKeys = new Set(
        result.flatMap(({ message }) => {
          const matches = message.matchAll(/\$([a-z_]+)\$/g);
          return Array.from(matches).map((match) => match[1]);
        })
      );

      const variables = Array.from(uniqueKeys);

      reply.send({ variables });
    }
  );
};
