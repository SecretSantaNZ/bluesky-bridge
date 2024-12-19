import type { FastifyPluginAsync } from 'fastify';
import { validateAuth } from '../../util/validateAuth.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthorizedError } from 'http-errors-enhanced';

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
    console.log('User authenticated as:', session.did);

    const { returnUrl } = JSON.parse(state as string);

    await app.blueskyBridge.playerService.createPlayer(session.did);
    const sessionToken = await app.blueskyBridge.authTokenManager.generateToken(
      session.did,
      {}
    );
    reply.setCookie('session', sessionToken, { path: '/', sameSite: 'strict' });
    reply.setCookie('login-session', '', { path: '/', expires: new Date(0) });

    reply.redirect(303, returnUrl);
  });

  app.withTypeProvider<ZodTypeProvider>().post(
    '/atproto-login',
    {
      // Type to any to avoid this messing with the type of request and breaking the schema
      onRequest: validateAuth(
        ({ loginTokenManager }) => loginTokenManager,
        'login-session'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
      schema: {
        body: z.object({
          handle: z.string(),
          requestId: z.string(),
        }),
      },
    },
    async (request, reply) => {
      if (
        request.tokenSubject == null ||
        request.tokenSubject !== request.body.requestId
      ) {
        throw new UnauthorizedError();
      }
      const client = app.blueskyBridge.atOauthClient;
      const handle = request.body.handle;
      const fullPerms = app.blueskyBridge.fullScopeHandles.has(
        handle.toLowerCase()
      );
      const state = JSON.stringify({
        requestId: request.tokenSubject,
        returnUrl: request.tokenData?.returnUrl,
      });

      const url = await client.authorize(handle, {
        state,
        scope: fullPerms
          ? 'atproto transition:generic transition:chat.bsky'
          : 'atproto',
      });

      reply.redirect(303, url.href);
    }
  );
};
