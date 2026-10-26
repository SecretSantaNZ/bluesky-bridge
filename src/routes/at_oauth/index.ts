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
import { addHours, addMinutes, isBefore, parseISO } from 'date-fns';
import type { Player } from '../../lib/PlayerService.js';
import { returnLoginView } from '../view/index.js';
import { startMastodonOauth } from '../mastodon/index.js';
import type { DatabaseSchema } from '../../lib/database/schema.js';
import type { InsertObject } from 'kysely';
import {
  BadRequestError,
  TooManyRequestsError,
  UnauthorizedError,
} from 'http-errors-enhanced';
import { unauthenticatedAgent } from '../../bluesky.js';
import { tz, TZDate } from '@date-fns/tz';
import ms from 'ms';
import {
  clientKeyFromRequest,
  createRateLimiter,
} from '../../util/rateLimit.js';
import type { Database } from '../../lib/database/index.js';
import { addHours as addHoursFn } from 'date-fns';

const OTP_ATTEMPT_LIMIT = 3;
const SESSION_MAX_AGE_HOURS = 12;

/** Normalizes a Bluesky handle: strips leading @, lower-cases, converts
 *  nested @ separators to dots, and assumes a single-label handle is on
 *  .bsky.social. */
export function normalizeBlueskyHandle(rawHandle: string): string {
  let handle = rawHandle
    .replace(/^@/, '')
    .replace(/@/g, '.')
    .trim()
    .toLowerCase();
  if (!handle.includes('.')) {
    handle += '.bsky.social';
  }
  return handle;
}

/** Marks an otp_login as consumed, bumping its attempt counter. Only rows
 *  that are unexpired and below the attempt limit are returned. */
export const consumeOtpLogin = async (db: Database, key: string) =>
  await db
    .updateTable('otp_login')
    .set((eb) => ({
      attempts: eb('attempts', '+', 1),
    }))
    .where('key', '=', key)
    .where('expires', '>', new Date().toISOString())
    .where('attempts', '<', OTP_ATTEMPT_LIMIT)
    .returningAll()
    .executeTakeFirst();

/** Constant-time comparison of the requested login code against the stored
 *  code, tolerating codes shorter than 6 digits by zero-padding. */
export function verifyLoginCode(
  requestedCode: string,
  expectedCode: string
): boolean {
  const codeBuffer = Buffer.from(
    (requestedCode + '000000').substring(0, 6),
    'utf8'
  );
  const expectedCodeBuffer = Buffer.from(expectedCode, 'utf-8');
  return timingSafeEqual(codeBuffer, expectedCodeBuffer);
}

/** Signups open 24 hours after the configured date, evaluated in the
 *  Pacific/Auckland timezone. */
export function getSignupsOpenDate(settings: { signups_open_date: string }) {
  return addHoursFn(
    parseISO(settings.signups_open_date, {
      in: tz('Pacific/Auckland'),
    }),
    24
  );
}

export function signupsNotYetOpen(
  settings: { signups_open_date: string },
  now = new Date()
) {
  return isBefore(now, getSignupsOpenDate(settings));
}

/** A session must be renewed after 12 hours. */
export function isSessionExpired(startedAt: string, now = new Date()) {
  return isBefore(startedAt, addHours(now, -SESSION_MAX_AGE_HOURS));
}

type SignupBridge = Pick<
  FastifyInstance['blueskyBridge'],
  'db' | 'playerService'
>;

/** Applies Mastodon eligibility rules and the signups gate: returns a new or
 *  existing player, or the reason join was denied. */
export async function getOrCreatePlayer(
  bridge: SignupBridge,
  did: string,
  player_type: 'bluesky' | 'mastodon',
  attributes: Partial<InsertObject<DatabaseSchema, 'player'>>
): Promise<{
  player?: Player;
  denied?: 'mastodon-disabled' | 'signups-closed';
}> {
  const { db, playerService } = bridge;
  const settings = await db
    .selectFrom('settings')
    .selectAll()
    .executeTakeFirstOrThrow();
  if (player_type === 'mastodon' && !settings.mastodon_players) {
    return { denied: 'mastodon-disabled' };
  }
  if (settings.signups_open || playerService.ensureElfDids.has(did)) {
    return {
      player: await playerService.createPlayer(did, player_type, attributes),
    };
  }
  return { player: await playerService.getPlayer(did) };
}

async function startAtOauth(
  request: FastifyRequest,
  reply: FastifyReply,
  blueskyBridge: FastifyInstance['blueskyBridge'],
  rawHandle: string,
  returnToken: string,
  mode: string,
  otpLogin: boolean
) {
  let returnUrl = '/';
  try {
    const client = blueskyBridge.atOauthClient;
    const handle = normalizeBlueskyHandle(rawHandle);
    const fullPerms = blueskyBridge.fullScopeHandles.has(handle.toLowerCase());

    const { subject: requestId, data } =
      await blueskyBridge.returnTokenManager.validateToken(returnToken);
    returnUrl = data.returnUrl;

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
          attempts: 0,
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

      return reply.view('auth/partials/otp-login', {
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

    if (request.headers['x-alpine-request']) {
      return reply.view('common/server-events', {
        redirectTo: url.href,
        startRequestFrom: '#login',
      });
    } else {
      return reply.redirect(url.href, 303).send();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    request.log.error(e);

    return returnLoginView(blueskyBridge, reply, returnUrl, {
      errorMessage: 'message' in e ? e.message : 'Unknown error',
      mode,
      handle: rawHandle,
      isAlpineRequest: Boolean(request.headers['x-alpine-request']),
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

    const { player: playerResult, denied } = await getOrCreatePlayer(
      { db, playerService },
      did,
      player_type,
      attributes
    );
    if (denied === 'mastodon-disabled') {
      throw new BadRequestError('Mastodon players are not allowed');
    }
    const player = playerResult;
    const admin = player?.admin ? true : undefined;
    if (player == null) {
      const didDoc = await didResolver.resolve(did);
      const player_handle = (didDoc?.alsoKnownAs?.[0] ?? '').replace(
        'at://',
        ''
      );

      return reply.view(
        signupsNotYetOpen(settings, new TZDate(new Date(), 'Pacific/Auckland'))
          ? 'player/signups-not-open'
          : 'player/signups-closed',
        {
          settings,
          replaceUrl: '/',
          player: undefined,
          player_handle,
          player_display_handle:
            player_type === 'mastodon'
              ? attributes.mastodon_account
              : player_handle,
        }
      );
    } else if (player.booted && !admin) {
      return reply.view(
        'player/booted-out',
        {
          settings,
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

    if (request.headers['x-alpine-request']) {
      return reply.view('common/server-events', {
        redirectTo: returnUrl ?? '/',
        startRequestFrom: '#login',
      });
    }
    return reply.redirect(returnUrl ?? '/', 303);
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
      isAlpineRequest: Boolean(request.headers['x-alpine-request']),
    });
  }
}

export const at_oauth: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  // Rate limits to protect the unauthenticated login endpoints from abuse.
  // Each OTP login code that is issued sends a DM to the target player, and
  // each verification attempt is a guess of that code, so both issuing and
  // verifying need to be rate limited per target handle. request.ip is the
  // reverse proxy for every request so client keyed limits use the address
  // appended to X-Forwarded-For by the reverse proxy.
  const loginClientLimiter = createRateLimiter({
    windowMs: ms('15 minutes'),
    max: 100,
  });
  const loginHandleLimiter = createRateLimiter({
    windowMs: ms('15 minutes'),
    max: 10,
  });
  const otpIssueHandleLimiter = createRateLimiter({
    windowMs: ms('15 minutes'),
    max: 5,
  });
  const otpVerifyClientLimiter = createRateLimiter({
    windowMs: ms('15 minutes'),
    max: 100,
  });
  const otpVerifyDidLimiter = createRateLimiter({
    windowMs: ms('15 minutes'),
    max: 15,
  });

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
      if (!otpVerifyClientLimiter(clientKeyFromRequest(request))) {
        throw new TooManyRequestsError(
          'Too many login attempts, try again in a few minutes'
        );
      }
      // The key is only useful together with its code, but the did of the
      // targeted player is enough to rate limit guesses of that code.
      const existingOtp = await this.blueskyBridge.db
        .selectFrom('otp_login')
        .select('did')
        .where('key', '=', request.body.otpKey)
        .executeTakeFirst();
      if (existingOtp != null && !otpVerifyDidLimiter(existingOtp.did)) {
        throw new TooManyRequestsError(
          'Too many login attempts, try again in a few minutes'
        );
      }
      const result = await consumeOtpLogin(
        this.blueskyBridge.db,
        request.body.otpKey
      );
      if (result == null) {
        throw new Error('Expired Key');
      }
      if (!verifyLoginCode(request.body.code, result.code)) {
        throw new Error('Invalid code');
      }

      await this.blueskyBridge.db
        .deleteFrom('otp_login')
        .where('key', '=', request.body.otpKey)
        .executeTakeFirst();

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

  app.setErrorHandler(async function (error, request, reply) {
    newrelic.noticeError(error as Error, {
      method: request.method,
      url: request.url,
      // @ts-expect-error no type
      ...request.body,
    });
    request.log.error({ url: request.url, error, body: request.body });
    return returnLoginView(app.blueskyBridge, reply, request.url, {
      errorMessage: (error as Error).message || 'Unknown Error',
      mode: (request.body as Record<string, string>)?.mode,
      handle: (request.body as Record<string, string>)?.handle,
      isAlpineRequest: Boolean(request.headers['x-alpine-request']),
    });
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
          otpLogin: z.union([z.string(), z.array(z.string())]).optional(),
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

      let otpLogin = false;
      if (request.body.otpLogin) {
        otpLogin = Array.isArray(request.body.otpLogin)
          ? Boolean(request.body.otpLogin[0])
          : Boolean(request.body.otpLogin);
      }

      // Mirror the handle normalisation used when logging in so that
      // variations of the same handle share a rate limit.
      const handleKey =
        request.body.accountType === 'bluesky'
          ? normalizeBlueskyHandle(request.body.handle)
          : request.body.handle.replace(/^@/, '').trim().toLowerCase();
      if (
        !loginClientLimiter(clientKeyFromRequest(request)) ||
        !loginHandleLimiter(handleKey) ||
        (otpLogin &&
          request.body.accountType === 'bluesky' &&
          !otpIssueHandleLimiter(handleKey))
      ) {
        throw new TooManyRequestsError(
          'Too many login attempts, try again in a few minutes'
        );
      }

      if (request.body.accountType === 'bluesky') {
        return startAtOauth(
          request,
          reply,
          this.blueskyBridge,
          request.body.handle,
          request.body.returnToken,
          request.body.mode,
          otpLogin
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

  const validateSessionCookie = validateAuth(
    ({ authTokenManager }) => authTokenManager,
    'session'
  );
  app.get(
    '/session-keep-alive',
    {
      onRequest: async function (request, reply) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await validateSessionCookie.bind(this as any)(request);
        } catch (err) {
          if (err instanceof UnauthorizedError) {
            return reply
              .code(401)
              .view('common/server-events', { reload: true });
          }
          throw err;
        }
      },
    },
    async function (request, reply) {
      const startedAt = request.tokenData?.startedAt as string;
      const handle = request.tokenData?.handle as string;
      // If session is too old, clear cookie and refresh to require new login
      if (isSessionExpired(startedAt)) {
        return reply
          .clearCookie('session')
          .code(401)
          .view('common/server-events', { reload: true });
      }
      const playerDid = request.tokenSubject as string;
      const player =
        await this.blueskyBridge.playerService.getPlayer(playerDid);
      // If player is unknown or booted, refresh to show the error screen
      if (player == null || (player.booted && !player.admin)) {
        return reply.code(401).view('common/server-events', { reload: true });
      }

      const sessionToken =
        await app.blueskyBridge.authTokenManager.generateToken(playerDid, {
          csrfToken: request.tokenData?.csrfToken as string,
          startedAt,
          handle,
          // Only propagate the admin claim if the player is still an admin in
          // the database, so that demoted elves lose access when their session
          // is refreshed rather than at the end of the 12 hour session cap.
          admin: player.admin ? true : undefined,
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
