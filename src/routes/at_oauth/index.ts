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

    const [didDoc, profile] = await Promise.all([
      app.blueskyBridge.didResolver.resolve(session.did),
      app.blueskyBridge
        .santaAgent()
        .then((agent) => agent.getProfile({ actor: session.did })),
    ]);

    reply.send({ didDoc, profile });
  });
  app.get('/atproto-login', async (request, reply) => {
    const client = app.blueskyBridge.atOauthClient;
    // @ts-expect-error query is untyped
    const handle = request.query.handle as string;
    const fullPerms = app.blueskyBridge.fullScopeHandles.has(
      handle.toLowerCase()
    );
    const state = randomUUID();

    const url = await client.authorize(handle, {
      state,
      scope: fullPerms
        ? 'atproto transition:generic transition:chat.bsky'
        : 'atproto',
    });

    reply.redirect(307, url.href);
  });
};
