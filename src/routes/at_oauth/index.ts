import { Agent } from '@atproto/api';
import { randomUUID } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';

export const at_oauth: FastifyPluginAsync = async (app) => {
  app.get('/client-metadata.json', (_, reply) =>
    reply.send(app.blueskyBridge.atOauthClient.clientMetadata)
  );
  app.get('/jwks.json', (_, reply) =>
    reply.send(app.blueskyBridge.atOauthClient.jwks)
  );
  app.get('/atproto-oauth-callback', async (request, reply) => {
    const client = app.blueskyBridge.atOauthClient;
    const params = new URLSearchParams(request.query as Record<string, string>);
    const { session, state } = await client.callback(params);

    // Process successful authentication here
    console.log('authorize() was called with state:', state);

    console.log('User authenticated as:', session.did);

    const didDoc = await app.blueskyBridge.didResolver.resolve(session.did);

    reply.send(didDoc);
  });
  app.get('/atproto-login', async (request, reply) => {
    const client = app.blueskyBridge.atOauthClient;
    // @ts-expect-error query is untyped
    const handle = request.query.handle;
    const state = randomUUID();

    const url = await client.authorize(handle, {
      state,
      scope: 'atproto',
    });

    reply.redirect(307, url.href);
  });
};
