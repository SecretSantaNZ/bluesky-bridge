import { createHash, randomBytes, randomUUID } from 'crypto';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { safeFetchWrap } from '@atproto-labs/fetch-node';
import wretch, {
  type WretchErrorCallback,
  type WretchResponseChain,
} from 'wretch';
import FormDataAddon from 'wretch/addons/formData';
import { BadRequestError } from 'http-errors-enhanced';
import { unauthenticatedAgent } from '../../bluesky.js';
import { finishLogin } from '../at_oauth/index.js';

const w = wretch()
  .polyfills({
    fetch: safeFetchWrap(),
  })
  .addon(FormDataAddon)
  .options({
    redirect: 'manual',
  });

const registrationResponseSchema = z.object({
  client_id: z.string(),
  client_secret: z.string(),
});

const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  scope: z.string(),
  created_at: z.number(),
});

const mastoUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  acct: z.string(),
});

const webfingerSchema = z.object({
  subject: z.string(),
  links: z.array(
    z.object({
      rel: z.string(),
      type: z.string().optional(),
      href: z.string().optional(),
    })
  ),
});

export function getBridgedHandle(mastodon_account: string) {
  return `${mastodon_account.replace(/[_~]/g, '-').replace('@', '.')}.ap.brid.gy`;
}

const followOneRedirect = <T, C>(
  chain: C & WretchResponseChain<T, C, undefined>
): C & WretchResponseChain<T, C, undefined> => {
  let redirectCount = 0;
  const callback: WretchErrorCallback<T, C, undefined> = (error, req) => {
    const location = error.response.headers.get('location');
    if (location == null) throw error;
    if (redirectCount > 0) {
      throw new Error(
        `Only a single redirect is allowed but tried ${location} from ${error.url}`
      );
    }
    redirectCount++;
    const locationUrl = new URL(location);
    const initialLocationUrl = new URL(error.url);
    locationUrl.host = initialLocationUrl.host;
    if (locationUrl.href !== initialLocationUrl.href) {
      throw new Error(
        `Redirect is only allowed to change host but tried ${location} from ${error.url}`
      );
    }
    return req.url(location).get().json();
  };
  return chain
    .error(301, callback)
    .error(302, callback)
    .error(307, callback)
    .error(308, callback);
};

export async function resolveMastodonHandle(
  handle: string,
  host: string,
  resolvesRemaining = 1
) {
  const webfingerUrl = new URL('/.well-known/webfinger', `https://${host}`);
  const resource = `acct:${handle}`;
  webfingerUrl.searchParams.set('resource', resource);

  const webfingerResult = webfingerSchema.parse(
    await followOneRedirect(w.get(webfingerUrl.href)).json()
  );
  if (webfingerResult.subject.toLowerCase() !== resource.toLowerCase()) {
    throw new Error(
      `Invalid subject, expected ${resource} but was ${webfingerResult.subject}`
    );
  }

  const selfLinkRecord = webfingerResult.links.find(
    (link) =>
      link.rel === 'self' &&
      (link.type ===
        'application/ld+json; profile="https://www.w3.org/ns/activitystreams"' ||
        link.type === 'application/activity+json')
  );
  if (selfLinkRecord == null || selfLinkRecord.href == null) {
    throw new Error(`No self link for ${resource}`);
  }
  const selfUrl = new URL(selfLinkRecord.href);
  if (selfUrl.host === host) {
    const resolvedHandle = webfingerResult.subject.substring('acct:'.length);
    return { host, handle: resolvedHandle };
  }
  if (resolvesRemaining <= 0) {
    throw new Error(`Too many resolves for ${resource}`);
  }
  return resolveMastodonHandle(handle, selfUrl.host);
}

export async function startMastodonOauth(
  request: FastifyRequest,
  reply: FastifyReply,
  blueskyBridge: FastifyInstance['blueskyBridge'],
  rawHandle: string,
  returnToken: string,
  mode: string
) {
  const baseUrl = process.env.PUBLIC_BASE_URL as string;
  const redirectUri = `${baseUrl}/mastodon/callback`;
  const { db, playerService } = blueskyBridge;
  const handle = rawHandle.replace(/^@/, '').trim();
  const [username, instance] = handle.split('@');
  if (!username || !instance) {
    throw new BadRequestError('Cannot parse instance');
  }

  const { host } = await resolveMastodonHandle(handle, instance);

  const {
    subject: requestId,
    data: { returnUrl },
  } = await blueskyBridge.returnTokenManager.validateToken(returnToken);

  let clientKey = host;
  let client_name = baseUrl;
  let scopes = 'profile';
  if (
    handle.toLowerCase() === playerService.santaMastodonHandle.toLowerCase()
  ) {
    clientKey = clientKey + ':full-access';
    client_name = baseUrl + ' - full-access';
    scopes = 'read write profile';
  }

  let client = await db
    .selectFrom('mastodon_client')
    .selectAll()
    .where('instance', '=', clientKey)
    .executeTakeFirst();
  if (client == null) {
    const registerUrl = new URL('/api/v1/apps', `https://${host}`).href;
    const registration = registrationResponseSchema.parse(
      await w
        .post(
          {
            client_name,
            redirect_uris: [redirectUri],
            scopes,
            website: baseUrl,
          },
          registerUrl
        )
        .json()
    );

    client = {
      instance: clientKey,
      ...registration,
    };

    await db.insertInto('mastodon_client').values(client).execute();
  }

  const stateKey = 'mastodon-' + randomUUID();
  const pkceVerifier = (await randomBytes(16)).toString('base64url');
  const pkceChallange = createHash('sha256')
    .update(pkceVerifier, 'utf-8')
    .digest()
    .toString('base64url');
  const state = JSON.stringify({
    appState: JSON.stringify({
      requestId,
      returnUrl,
      mode,
    }),
    pkceVerifier,
    handle,
    username,
    instance,
    host,
    clientKey,
  });
  await db
    .insertInto('at_oauth_state')
    .values({
      key: stateKey,
      data: state,
      created_at: new Date().toISOString(),
    })
    .execute();

  const authorizeUrl = new URL('/oauth/authorize', `https://${instance}`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', client.client_id);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', scopes);
  authorizeUrl.searchParams.set('state', stateKey);
  authorizeUrl.searchParams.set('code_challenge', pkceChallange);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('login_hint', handle);

  return reply.code(204).header('HX-Redirect', authorizeUrl.href).send();
}

export const mastodon: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/callback',
    {
      schema: {
        querystring: z.object({
          code: z.string(),
          state: z.string(),
        }),
      },
    },
    async function (request, reply) {
      const { db, playerService } = rawApp.blueskyBridge;
      const stateRecord = await db
        .deleteFrom('at_oauth_state')
        .returningAll()
        .where('key', '=', request.query.state)
        .executeTakeFirstOrThrow();
      return finishLogin(
        request,
        reply,
        app.blueskyBridge,
        'mastodon',
        stateRecord,
        async () => {
          const {
            pkceVerifier,
            username: initialUsername,
            instance: initialInstance,
            host,
            clientKey,
          } = JSON.parse(stateRecord.data);

          const tokenUrl = new URL('/oauth/token', `https://${host}`).href;

          const baseUrl = process.env.PUBLIC_BASE_URL as string;
          const redirectUri = `${baseUrl}/mastodon/callback`;

          const client = await db
            .selectFrom('mastodon_client')
            .selectAll()
            .where('instance', '=', clientKey)
            .executeTakeFirstOrThrow();

          const { access_token, created_at } = tokenResponseSchema.parse(
            await w
              .url(tokenUrl)
              .formData({
                grant_type: 'authorization_code',
                code: request.query.code,
                client_id: client.client_id,
                client_secret: client.client_secret,
                redirect_uri: redirectUri,
                code_verifier: pkceVerifier,
              })
              .post()
              .json()
          );

          const verifyUrl = new URL(
            '/api/v1/accounts/verify_credentials',
            `https://${host}`
          ).href;
          const { id: id_from_user, username: resolvedUsername } =
            mastoUserSchema.parse(
              await w
                .headers({
                  Authorization: `Bearer ${access_token}`,
                })
                .get(verifyUrl)
                .json()
            );
          if (
            resolvedUsername.toLowerCase() !== initialUsername.toLowerCase()
          ) {
            throw new Error(
              `Auth stated for ${initialUsername}@${initialInstance} but when resolved was ${resolvedUsername}`
            );
          }
          const mastodon_account = `${resolvedUsername}@${initialInstance}`;
          const santaMastodonHandle = playerService.santaMastodonHandle;
          if (
            mastodon_account.toLowerCase() === santaMastodonHandle.toLowerCase()
          ) {
            await this.blueskyBridge.db
              .insertInto('mastodon_token')
              .values({
                account: santaMastodonHandle,
                client_id: client.client_id,
                mastodon_id: id_from_user,
                token: access_token,
                issued_at: new Date(created_at * 1000).toISOString(),
              })
              .onConflict((cb) =>
                cb.doUpdateSet({
                  client_id: client.client_id,
                  token: access_token,
                  issued_at: new Date(created_at * 1000).toISOString(),
                })
              )
              .execute();
          }

          const bskyHandle = getBridgedHandle(mastodon_account);
          let did = '';
          try {
            const response = await unauthenticatedAgent.resolveHandle({
              handle: bskyHandle,
            });
            did = response.data.did;
          } catch (error) {
            request.log.error(error);
            throw new Error(
              `Unable to resolve Bluesky account ${bskyHandle} for account ${mastodon_account}. Have you set up bridgy fed?`
            );
          }

          const following =
            await playerService.lookupMastodonFollowing(mastodon_account);
          return {
            did,
            attributes: {
              mastodon_account,
              mastodon_host: host,
              ...following,
            },
          };
        }
      );
    }
  );
};
