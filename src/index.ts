import path from 'path';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import z from 'zod';
import { RichText } from '@atproto/api';

import { getBskyAgent } from './bluesky.js';

dotenv.config({
  path: [
    path.resolve(process.cwd(), '.env'),
    `${process.env.CREDENTIALS_DIRECTORY}/bluesky-bridge-creds`,
  ],
});

const fastify = Fastify({
  logger: true,
});

// Add schema validator and serializer
fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

// Declare a route
fastify.withTypeProvider<ZodTypeProvider>().get('/', async (request, reply) => {
  reply.send({ ok: true });
});
fastify.withTypeProvider<ZodTypeProvider>().post(
  '/action/dm',
  {
    schema: {
      body: z.object({
        sendToDid: z.string(),
        message: z.string(),
      }),
    },
  },
  async (request, reply) => {
    const client = await getBskyAgent();
    const sendFromDid = client.session?.did as string;
    const {
      data: { convo },
    } = await client.api.chat.bsky.convo.getConvoForMembers(
      {
        members: [sendFromDid, request.body.sendToDid],
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
    // await client.post({
    //   text: 'this is a test, for reasons\n\nHello @orthanc.bsky.social\n\n',
    //   facets: [
    //     {
    //       features: [
    //         {
    //           $type: 'app.bsky.richtext.facet#mention',
    //           did: 'did:plc:k626emd4xi4h3wxpd44s4wpk',
    //         },
    //       ],
    //       index: {
    //         byteStart: 35,
    //         byteEnd: 55,
    //       },
    //     },
    //   ],
    // });
    reply.send(result);
  }
);

// Declare a route
fastify.withTypeProvider<ZodTypeProvider>().post(
  '/',
  {
    schema: {
      body: z.object({
        message: z.string(),
      }),
    },
  },
  async (request, reply) => {
    const client = await getBskyAgent();
    // await client.post({
    //   text: request.body.message,
    //   // facets: [
    //   //   {
    //   //     features: [
    //   //       {
    //   //         $type: 'app.bsky.richtext.facet#mention',
    //   //         did: 'did:plc:k626emd4xi4h3wxpd44s4wpk',
    //   //       },
    //   //     ],
    //   //     index: {
    //   //       byteStart: 35,
    //   //       byteEnd: 55,
    //   //     },
    //   //   },
    //   // ],
    // });
    reply.send({ ok: true });
  }
);

// Run the server!
fastify.listen({ port: 3000 }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`Server is now listening on ${address}`);
});
