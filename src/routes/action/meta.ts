import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadSettings } from '../../lib/settings.js';

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

  app.get('/nudge/types', async function (request, reply) {
    const result = await this.blueskyBridge.db
      .selectFrom('message')
      .select('message_type')
      .distinct()
      .execute();

    const types = result
      .filter(({ message_type }) => message_type.startsWith('nudge-'))
      .map(({ message_type }) => message_type.substring(6));
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
      const [result, settings] = await Promise.all([
        this.blueskyBridge.db
          .selectFrom('message')
          .select('message')
          .where('message_type', '=', 'dm-' + request.query.message_type)
          .execute(),
        loadSettings(this.blueskyBridge.db),
      ]);

      const uniqueKeys = new Set(
        result.flatMap(({ message }) => {
          const matches = message.matchAll(/\$([a-z_]+)\$/g);
          return Array.from(matches).map((match) => match[1]);
        })
      );
      Object.keys(settings).forEach((key) => uniqueKeys.delete(key));

      const variables = Array.from(uniqueKeys);

      reply.send({ variables });
    }
  );
};
