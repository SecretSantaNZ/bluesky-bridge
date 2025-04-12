import newrelic from 'newrelic';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { validateAuth } from '../../util/validateAuth.js';
import { addHours, addMinutes, isBefore } from 'date-fns';
import type { Player } from '../../lib/PlayerService.js';
import { returnLoginView } from '../view/index.js';
import { startMastodonOauth } from '../mastodon/index.js';
import type { DatabaseSchema } from '../../lib/database/schema.js';
import type { InsertObject } from 'kysely';
import { BadRequestError } from 'http-errors-enhanced';
import { unauthenticatedAgent } from '../../bluesky.js';

async function startAtOauth(
  request: FastifyRequest,
  reply: FastifyReply,
  blueskyBridge: FastifyInstance['blueskyBridge'],
  rawHandle: string,
  returnToken: string,
  mode: string,
  otpLogin: boolean
) {
  try {
    const client = blueskyBridge.atOauthClient;
    let handle = rawHandle
      .replace(/^@/, '')
      .replace(/@/g, '.')
      .trim()
      .toLowerCase();
    if (!handle.includes('.')) {
      handle += '.bsky.social';
    }
    const fullPerms = blueskyBridge.fullScopeHandles.has(handle.toLowerCase());

    const {
      subject: requestId,
      data: { returnUrl },
    } = await blueskyBridge.returnTokenManager.validateToken(returnToken);

    if (otpLogin) {
      const resolveResult = await unauthenticatedAgent.resolveHandle({
        handle,
      });

      const did = resolveResult.data.did;
      const player = await blueskyBridge.playerService.getPlayer(did);
      if (player == null || (player.booted && !player.admin)) {
        throw new Error('Unknown player');
      }
      if (player.player_dm_status.startsWith('error:')) {
        throw new Error('DMs disabled');
      }

      const key = randomBytes(21).toString('base64url');
      const code = String(randomInt(1000000) + 1000000).substring(1);
      const expires = addMinutes(new Date(), 15).toISOString();
      await blueskyBridge.db
        .insertInto('otp_login')
        .values({
          key,
          code,
          did,
          expires,
        })
        .execute();

      await blueskyBridge.playerService.dmSender.sendDm({
        dmType: 'otp-login',
        playerType: player.player_type,
        recipientDid: did,
        recipientHandle: player.handle,
        recipientMastodonHandle: player.mastodon_account,
        recordId: -1,
        rawMessage: `Login to the app with code:\n\n${code}\n\nIf you are not trying to login right now, you can ignore this DM.`,
        markSent: () => Promise.resolve(undefined),
        markError: (errorText) => Promise.reject(new Error(errorText)),
      });

      return reply.view('auth/otp-login.ejs', {
        key,
        returnToken,
      });
    }

    const state = JSON.stringify({
      requestId,
      returnUrl,
      mode,
      handle,
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
  process: () => Promise<{
    did: string;
    handle?: string;
    attributes: Partial<InsertObject<DatabaseSchema, 'player'>>;
  }>
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state: any = stateRecord == null ? {} : JSON.parse(stateRecord.data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appState: any =
    state.appState == null ? {} : JSON.parse(state.appState);
  const { returnUrl, handle } = appState;
  newrelic.recordCustomEvent('SecretSantaFinishLogin', {
    handle,
    accountType: player_type,
  });
  try {
    const { playerService, db, didResolver } = blueskyBridge;
    const { did, attributes } = await process();

    const settings = await db
      .selectFrom('settings')
      .selectAll()
      .executeTakeFirstOrThrow();

    if (player_type === 'mastodon' && !settings.mastodon_players) {
      throw new BadRequestError('Mastodon players are not allowed');
    }

    let player: Player | undefined;
    if (settings.signups_open || playerService.ensureElfDids.has(did)) {
      player = await playerService.createPlayer(did, player_type, attributes);
    } else {
      player = await playerService.getPlayer(did);
    }
    const admin = player?.admin ? true : undefined;
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
          player_display_handle:
            player_type === 'mastodon'
              ? attributes.mastodon_account
              : player_handle,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    } else if (player.booted && !admin) {
      return reply.view(
        'player/booted-out-card.ejs',
        {
          hideClose: true,
          replaceUrl: '/',
          player,
          player_display_handle:
            player.player_type === 'mastodon'
              ? player.mastodon_account
              : player.handle,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }

    const csrfToken = randomUUID();
    const sessionToken = await blueskyBridge.authTokenManager.generateToken(
      did,
      {
        csrfToken,
        startedAt: new Date().toISOString(),
        handle: (player.player_type === 'mastodon'
          ? player.mastodon_account
          : player.handle) as string,
        admin,
      }
    );
    reply.setCookie('session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 24 * 60 * 60,
    });

    if (request.headers['hx-request']) {
      return reply.header('HX-Refresh', 'true').code(204).send();
    }
    return reply.redirect(303, returnUrl ?? '/');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    newrelic.noticeError(e, {
      handle,
      accountType: player_type,
      location: 'finishLogin',
    });
    request.log.error(e);
    return returnLoginView(blueskyBridge, reply, returnUrl ?? '/', {
      errorMessage: 'message' in e ? e.message : 'Unknown error',
      mode: appState.mode,
      handle,
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
        return { did: session.did, attributes: {} };
      }
    );
  });

  app.post(
    '/finish-otp-login',
    {
      schema: {
        body: z.object({
          returnToken: z.string(),
          otpKey: z.string(),
          code: z.string(),
        }),
      },
    },
    async function (request, reply) {
      const result = await this.blueskyBridge.db
        .selectFrom('otp_login')
        .selectAll()
        .where('key', '=', request.body.otpKey)
        .where('expires', '>', new Date().toISOString())
        .executeTakeFirst();
      if (result == null) {
        throw new Error('Expired Key');
      }
      const codeBuffer = Buffer.from(
        (request.body.code + '000000').substring(0, 6),
        'utf8'
      );
      const expectedCodeBuffer = Buffer.from(result.code, 'utf-8');
      if (!timingSafeEqual(codeBuffer, expectedCodeBuffer)) {
        throw new Error('Invalid code');
      }

      return finishLogin(
        request,
        reply,
        app.blueskyBridge,
        'bluesky',
        undefined,
        async () => {
          return { did: result.did, attributes: {} };
        }
      );
    }
  );

  app.post(
    '/start-login',
    {
      schema: {
        body: z.object({
          handle: z.string(),
          returnToken: z.string(),
          mode: z.string(),
          accountType: z.enum(['bluesky', 'mastodon']),
          otpLogin: z.string().optional(),
        }),
      },
    },
    async function (request, reply) {
      newrelic.recordCustomEvent('SecretSantaStartLogin', {
        handle: request.body.handle,
        mode: request.body.mode,
        accountType: request.body.accountType,
      });
      const settings = await this.blueskyBridge.db
        .selectFrom('settings')
        .selectAll()
        .executeTakeFirstOrThrow();

      if (
        request.body.accountType === 'mastodon' &&
        !settings.mastodon_players
      ) {
        throw new BadRequestError('Mastodon players are not allowed');
      }

      if (request.body.accountType === 'bluesky') {
        return startAtOauth(
          request,
          reply,
          this.blueskyBridge,
          request.body.handle,
          request.body.returnToken,
          request.body.mode,
          Boolean(request.body.otpLogin)
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
      const handle = request.tokenData?.handle as string;
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
      if (player == null || (player.booted && !player.admin)) {
        return reply.code(204).header('HX-Refresh', 'true').send();
      }

      const sessionToken =
        await app.blueskyBridge.authTokenManager.generateToken(playerDid, {
          csrfToken: request.tokenData?.csrfToken as string,
          startedAt,
          handle,
          admin: request.tokenData?.admin as true | undefined,
        });
      reply.setCookie('session', sessionToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: 24 * 60 * 60,
      });
      return reply.code(204).send();
    }
  );
};
