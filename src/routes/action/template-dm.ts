import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { RichText } from '@atproto/api';
import { getRandomMessage } from '../../util/getRandomMessage.js';
import { loadSettings } from '../../lib/settings.js';

export const templateDm: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/dm/:message_type',
    {
      schema: {
        params: z.object({
          message_type: z.string(),
        }),
        body: z
          .object({
            recipient_did: z.string(),
          })
          .catchall(z.string()),
      },
    },
    async function (request, reply) {
      const { message_type } = request.params;
      const { recipient_did, ...rest } = request.body;

      const settings = await loadSettings(this.blueskyBridge.db);
      const client = app.blueskyBridge.santaAgent;
      const sendFromDid = client.sessionManager.did as string;
      if (sendFromDid === request.body.recipient_did) {
        return reply.send({});
      }

      const rawMessage = getRandomMessage(
        this.blueskyBridge.db,
        'dm-' + message_type,
        { ...rest, ...settings }
      );

      const {
        data: { convo },
      } = await client.api.chat.bsky.convo.getConvoForMembers(
        {
          members: [sendFromDid, recipient_did],
        },
        {
          headers: {
            'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat',
          },
        }
      );

      const message = new RichText({
        text: rawMessage + ' [Sent by 🤖]',
      });
      await message.detectFacets(client);
      const { data: result } = await client.api.chat.bsky.convo.sendMessage(
        {
          convoId: convo.id,
          message: {
            text: message.text,
            facets: message.facets,
          },
        },
        {
          encoding: 'application/json',
          headers: {
            'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat',
          },
        }
      );
      reply.send(result);
    }
  );
};
