import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { unauthenticatedAgent } from '../../bluesky.js';
import { RichText } from '@atproto/api';
import { getRandomMessage } from '../../util/getRandomMessage.js';
import { loadSettings } from '../../lib/settings.js';

export const nudge: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/nudge/:nudge_type',
    {
      schema: {
        params: z.object({
          nudge_type: z.string(),
        }),
        body: z.object({
          recipient_did: z.string(),
          greeting: z.string(),
          signoff: z.string(),
        }),
      },
    },
    async function (request, reply) {
      const { nudge_type } = request.params;
      const { recipient_did, greeting, signoff, ...rest } = request.body;

      const settings = await loadSettings(this.blueskyBridge.db);
      const [messageBody, { data: profile }] = await Promise.all([
        getRandomMessage(this.blueskyBridge.db, 'nudge-' + nudge_type, {
          ...rest,
          ...settings,
        }),
        unauthenticatedAgent.getProfile({
          actor: recipient_did,
        }),
      ]);

      const rawMessage = `${greeting} @${profile.handle}. ${messageBody} ${signoff} [Sent by 🤖]`;
      const client = await app.blueskyBridge.robotAgent();

      const message = new RichText({
        text: rawMessage,
      });
      await message.detectFacets(client);

      const result = client.post({
        text: message.text,
        facets: message.facets,
      });

      reply.send(result);
    }
  );
};
