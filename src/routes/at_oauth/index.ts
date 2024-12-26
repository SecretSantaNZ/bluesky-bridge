import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { randomUUID } from 'crypto';

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
    const csrfToken = randomUUID();

    await app.blueskyBridge.playerService.createPlayer(session.did);
    const sessionToken = await app.blueskyBridge.authTokenManager.generateToken(
      session.did,
      { csrfToken }
    );
    reply.setCookie('session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
    });

    reply.redirect(303, returnUrl);
  });

  app.withTypeProvider<ZodTypeProvider>().post(
    '/atproto-login',
    {
      schema: {
        body: z.object({
          handle: z.string(),
          returnToken: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const client = app.blueskyBridge.atOauthClient;
      const handle = request.body.handle;
      const fullPerms = app.blueskyBridge.fullScopeHandles.has(
        handle.toLowerCase()
      );

      const {
        subject: requestId,
        data: { returnUrl },
      } = await app.blueskyBridge.returnTokenManager.validateToken(
        request.body.returnToken
      );
      const state = JSON.stringify({
        requestId,
        returnUrl,
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
