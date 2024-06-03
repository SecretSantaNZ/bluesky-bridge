import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getSantaBskyAgent } from '../../bluesky.js';
import { RichText } from '@atproto/api';

export const dm: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/dm',
    {
      schema: {
        body: z.object({
          recipient_did: z.string(),
          message: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const client = await getSantaBskyAgent();
      const sendFromDid = client.session?.did as string;
      if (sendFromDid === request.body.recipient_did) {
        return reply.send({});
      }
      const {
        data: { convo },
      } = await client.api.chat.bsky.convo.getConvoForMembers(
        {
          members: [sendFromDid, request.body.recipient_did],
        },
        {
          headers: {
            'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat',
          },
        }
      );

      const message = new RichText({
        text: request.body.message,
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
