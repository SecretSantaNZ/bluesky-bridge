import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { saveSettings } from '../../lib/settings.js';

export const settings: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.put(
    '/settings',
    {
      schema: {
        body: z.object({
          signups_open: z.boolean(),
          matches_sent_date: z.string().datetime(),
          send_by_date: z.string().datetime(),
          opening_date: z.string().datetime(),
          hashtag: z.string(),
          elf_list: z.string(),
        }),
      },
    },
    async function (request, reply) {
      await saveSettings(this.blueskyBridge.db, request.body);

      reply.send({
        ok: true,
      });
    }
  );
};
