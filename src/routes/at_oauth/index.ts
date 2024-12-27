import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { validateAuth } from '../../util/validateAuth.js';
import { addHours, addSeconds, isBefore } from 'date-fns';
import type { Player } from '../../lib/PlayerService.js';

export const at_oauth: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get('/client-metadata.json', (_, reply) =>
    reply.send(app.blueskyBridge.atOauthClient.clientMetadata)
  );
  app.get('/jwks.json', (_, reply) =>
    reply.send(app.blueskyBridge.atOauthClient.jwks)
  );

  app.get('/atproto-oauth-callback', async (request, reply) => {
    const {
      atOauthClient: client,
      playerService,
      db,
      didResolver,
    } = app.blueskyBridge;
    const params = new URLSearchParams(request.query as Record<string, string>);
    const { session, state } = await client.callback(params);

    const settings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();

    let player: Player | undefined;
    if (settings.signups_open) {
      player = await playerService.createPlayer(session.did);
    } else {
      player = await playerService.getPlayer(session.did);
    }
    if (player == null) {
      const didDoc = await didResolver.resolve(session.did);
      const player_handle = (didDoc?.alsoKnownAs?.[0] ?? '').replace(
        'at://',
        ''
      );
      return reply.view(
        'player/signups-closed-card.ejs',
        {
          replaceUrl: '/',
          player: undefined,
          player_handle,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    } else if (player.booted) {
      return reply.view(
        'player/booted-out-card.ejs',
        { hideClose: true, replaceUrl: '/', player },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }

    const { returnUrl } = JSON.parse(state as string);
    const csrfToken = randomUUID();
    const sessionToken = await app.blueskyBridge.authTokenManager.generateToken(
      session.did,
      { csrfToken, startedAt: new Date().toISOString() }
    );
    reply.setCookie('session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      expires: addSeconds(
        new Date(),
        app.blueskyBridge.authTokenManager.expiresInSeconds
      ),
    });

    reply.redirect(303, returnUrl);
  });

  app.post(
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

      return reply.code(204).header('HX-Redirect', url.href).send();
    }
  );

  app.get(
    '/session-keep-alive',
    {
      onRequest: validateAuth(
        ({ authTokenManager }) => authTokenManager,
        'session'
      ),
      onError: function (request, reply, error) {
        request.log.error(error);
        return reply.code(204).header('HX-Refresh', 'true').send();
      },
    },
    async function (request, reply) {
      const startedAt = request.tokenData?.startedAt as string;
      // If session is over 12 hours old, clear cookie and refresh to require new login
      if (isBefore(startedAt, addHours(new Date(), -12))) {
        return reply
          .clearCookie('session')
          .code(204)
          .header('HX-Refresh', 'true')
          .send();
      }
      const playerDid = request.tokenSubject as string;
      const player =
        await this.blueskyBridge.playerService.getPlayer(playerDid);
      // If player is unknown or booted, refresh to show the error screen
      if (player == null || player.booted) {
        return reply.code(204).header('HX-Refresh', 'true').send();
      }

      const sessionToken =
        await app.blueskyBridge.authTokenManager.generateToken(playerDid, {
          csrfToken: request.tokenData?.csrfToken as string,
          startedAt,
        });
      reply.setCookie('session', sessionToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        expires: addSeconds(
          new Date(),
          app.blueskyBridge.authTokenManager.expiresInSeconds
        ),
      });
      return reply.code(204).send();
    }
  );
};
