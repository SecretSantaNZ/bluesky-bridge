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
import wretch from 'wretch';
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
    redirect: 'error',
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

export async function startMastodonOauth(
  request: FastifyRequest,
  reply: FastifyReply,
  blueskyBridge: FastifyInstance['blueskyBridge'],
  rawHandle: string,
  returnToken: string,
  mode: string
) {
  const { db } = blueskyBridge;
  const handle = rawHandle
    .replace(/^@/, '')
    .replace(/^https:\/\//, '')
    .replace(/\/$/, '')
    .trim();
  const instance = handle.split('@').pop();
  if (instance == null) {
    throw new BadRequestError('Cannot parse instance');
  }
  const baseUrl = process.env.PUBLIC_BASE_URL as string;
  const redirectUri = `${baseUrl}/mastodon/callback`;

  const {
    subject: requestId,
    data: { returnUrl },
  } = await blueskyBridge.returnTokenManager.validateToken(returnToken);

  let client = await db
    .selectFrom('mastodon_client')
    .selectAll()
    .where('instance', '=', instance)
    .executeTakeFirst();
  if (client == null) {
    const registerUrl = new URL('/api/v1/apps', `https://${instance}`).href;
    const registration = registrationResponseSchema.parse(
      await w
        .post(
          {
            client_name: baseUrl,
            redirect_uris: [redirectUri],
            scopes: 'read write profile',
            website: baseUrl,
          },
          registerUrl
        )
        .json()
    );

    client = {
      instance,
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
    instance,
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
  authorizeUrl.searchParams.set('scope', 'profile');
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
      const { db } = rawApp.blueskyBridge;
      const state = await db
        .deleteFrom('at_oauth_state')
        .returningAll()
        .where('key', '=', request.query.state)
        .executeTakeFirstOrThrow();
      return finishLogin(
        request,
        reply,
        app.blueskyBridge,
        'mastodon',
        state,
        async () => {
          const { pkceVerifier, instance } = JSON.parse(state.data);

          const tokenUrl = new URL('/oauth/token', `https://${instance}`).href;

          const baseUrl = process.env.PUBLIC_BASE_URL as string;
          const redirectUri = `${baseUrl}/mastodon/callback`;

          const client = await db
            .selectFrom('mastodon_client')
            .selectAll()
            .where('instance', '=', instance)
            .executeTakeFirstOrThrow();

          const { access_token } = tokenResponseSchema.parse(
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
            `https://${instance}`
          ).href;
          const { username } = mastoUserSchema.parse(
            await w
              .headers({
                Authorization: `Bearer ${access_token}`,
              })
              .get(verifyUrl)
              .json()
          );
          // FIXME handle errors for can't resolve and similar
          const bridgyUsername = username.replace(/[_~]/g, '-');
          const bskyHandle = `${bridgyUsername}.${instance}.ap.brid.gy`;
          const response = await unauthenticatedAgent.resolveHandle({
            handle: bskyHandle,
          });

          return response.data.did;
        }
      );
    }
  );
};
