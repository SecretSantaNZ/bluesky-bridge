import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { validateAuth } from '../../util/validateAuth.js';
import { addHours, addSeconds, isBefore } from 'date-fns';
import type { Player } from '../../lib/PlayerService.js';
import { returnLoginView } from '../view/index.js';
import { startMastodonOauth } from '../mastodon/index.js';

async function startAtOauth(
  request: FastifyRequest,
  reply: FastifyReply,
  blueskyBridge: FastifyInstance['blueskyBridge'],
  rawHandle: string,
  returnToken: string,
  mode: string
) {
  try {
    const client = blueskyBridge.atOauthClient;
    let handle = rawHandle.replace(/^@/, '').replace(/@/g, '.').trim();
    if (!handle.includes('.')) {
      handle += '.bsky.social';
    }
    const fullPerms = blueskyBridge.fullScopeHandles.has(handle.toLowerCase());

    const {
      subject: requestId,
      data: { returnUrl },
    } = await blueskyBridge.returnTokenManager.validateToken(returnToken);
    const state = JSON.stringify({
      requestId,
      returnUrl,
      mode,
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

export async function finishLogin(
  request: FastifyRequest,
  reply: FastifyReply,
  blueskyBridge: FastifyInstance['blueskyBridge'],
  player_type: 'bluesky' | 'mastodon',
  stateRecord: { data: string } | undefined,
  process: () => Promise<string>
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state: any = stateRecord == null ? {} : JSON.parse(stateRecord.data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appState: any =
    state.appState == null ? {} : JSON.parse(state.appState);
  const { returnUrl } = appState;
  try {
    const { playerService, db, didResolver } = blueskyBridge;
    const did = await process();

    const settings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();

    let player: Player | undefined;
    if (settings.signups_open || playerService.ensureElfDids.has(did)) {
      player = await playerService.createPlayer(did, player_type);
    } else {
      player = await playerService.getPlayer(did);
    }
    if (player == null) {
      const didDoc = await didResolver.resolve(did);
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

    const csrfToken = randomUUID();
    const sessionToken = await blueskyBridge.authTokenManager.generateToken(
      did,
      {
        csrfToken,
        startedAt: new Date().toISOString(),
        admin,
      }
    );
    reply.setCookie('session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      expires: addSeconds(
        new Date(),
        blueskyBridge.authTokenManager.expiresInSeconds
      ),
    });

    reply.redirect(303, returnUrl ?? '/');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    request.log.error(e);
    return returnLoginView(blueskyBridge, reply, returnUrl ?? '/', {
      errorMessage: 'message' in e ? e.message : 'Unknown error',
      mode: appState.mode,
    });
  }
}

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
    return finishLogin(
      request,
      reply,
      app.blueskyBridge,
      'bluesky',
      retrievedState,
      async () => {
        const { session } =
          await app.blueskyBridge.atOauthClient.callback(params);
        return session.did;
      }
    );
  });

  app.post(
    '/start-login',
    {
      schema: {
        body: z.object({
          handle: z.string(),
          returnToken: z.string(),
          mode: z.string(),
          accountType: z.enum(['bluesky', 'mastodon']),
        }),
      },
    },
    async function (request, reply) {
      if (request.body.accountType === 'bluesky') {
        return startAtOauth(
          request,
          reply,
          this.blueskyBridge,
          request.body.handle,
          request.body.returnToken,
          request.body.mode
        );
      } else {
        return startMastodonOauth(
          request,
          reply,
          this.blueskyBridge,
          request.body.handle,
          request.body.returnToken,
          request.body.mode
        );
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
