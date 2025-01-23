import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { validateAuth } from '../../util/validateAuth.js';
import { addHours, addSeconds, isBefore } from 'date-fns';
import type { Player } from '../../lib/PlayerService.js';
import { returnLoginView } from '../view/index.js';

export const at_oauth: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get('/client-metadata.json', (_, reply) =>
    reply.send(app.blueskyBridge.atOauthClient.clientMetadata)
  );
  app.get('/jwks.json', (_, reply) =>
    reply.send(app.blueskyBridge.atOauthClient.jwks)
  );

  app.get('/atproto-oauth-callback', async function (request, reply) {
    const params = new URLSearchParams(request.query as Record<string, string>);
    const retrievedState = await this.blueskyBridge.db
      .selectFrom('at_oauth_state')
      .select('data')
      .where('key', '=', params.get('state'))
      .executeTakeFirst();
    try {
      const {
        atOauthClient: client,
        playerService,
        db,
        didResolver,
      } = app.blueskyBridge;
      const { session, state } = await client.callback(params);

      const settings = await db
        .selectFrom('settings')
        .selectAll()
        .executeTakeFirstOrThrow();

      let player: Player | undefined;
      if (
        settings.signups_open ||
        playerService.ensureElfDids.has(session.did)
      ) {
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

      const admin = player.admin ? true : undefined;

      const { returnUrl } = JSON.parse(state as string);
      const csrfToken = randomUUID();
      const sessionToken =
        await app.blueskyBridge.authTokenManager.generateToken(session.did, {
          csrfToken,
          startedAt: new Date().toISOString(),
          admin,
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

      reply.redirect(303, returnUrl);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      request.log.error(e);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state: any =
        retrievedState == null ? {} : JSON.parse(retrievedState.data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const appState: any =
        state.appState == null ? {} : JSON.parse(state.appState);
      return returnLoginView(
        this.blueskyBridge,
        reply,
        appState.returnUrl ?? '/',
        { errorMessage: 'message' in e ? e.message : 'Unknown error' }
      );
    }
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
      try {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        request.log.error(e);
        return reply.view('partials/error.ejs', {
          elementId: 'login-error',
          errorMessage: 'message' in e ? e.message : 'Unknown error',
        });
      }
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
          admin: request.tokenData?.admin as true | undefined,
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
