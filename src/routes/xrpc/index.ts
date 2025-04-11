import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Queries } from '@atcute/client/lexicons';
import '@atcute/bluesky/lexicons';
import { BadRequestError, UnauthorizedError } from 'http-errors-enhanced';
import { verifyJwt } from '@atproto/xrpc-server';
import { queryFullMatch } from '../../lib/database/index.js';

const NO_GIFTEE_POST =
  'at://did:plc:qaspeclp3zntiiaywz57zwza/app.bsky.feed.post/3lgn2zw3u2k2u';
const NO_POSTS_BY_GIFTEE =
  'at://did:plc:qaspeclp3zntiiaywz57zwza/app.bsky.feed.post/3lgn345mw2k2u';

export const xrpc: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  const serviceDid: `did:${string}` = `did:web:${process.env.TOKEN_ISSUER}`;
  const santaAccountDid = rawApp.blueskyBridge.santaAccountDid;
  const gifteeFeedUri = `at://${santaAccountDid}/app.bsky.feed.generator/3lgklut3vkw6t`;
  const hashtagFeedUri = `at://${santaAccountDid}/app.bsky.feed.generator/3lgmzql3sv6vk`;
  const hashtagWithRepliesFeedUri = `at://${santaAccountDid}/app.bsky.feed.generator/3lgmzr7qohmva`;
  app.get('/.well-known/did.json', function (_, reply) {
    return reply.send({
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: serviceDid,
      service: [
        {
          id: '#bsky_fg',
          type: 'BskyFeedGenerator',
          serviceEndpoint: process.env.PUBLIC_BASE_URL as string,
        },
      ],
    });
  });

  app.get('/xrpc/app.bsky.feed.describeFeedGenerator', function (_, reply) {
    const output: Queries['app.bsky.feed.describeFeedGenerator']['output'] = {
      did: serviceDid,
      feeds: [
        { uri: gifteeFeedUri },
        { uri: hashtagFeedUri },
        { uri: hashtagWithRepliesFeedUri },
      ],
    };

    return reply.send(output);
  });

  app.get(
    '/xrpc/app.bsky.feed.getFeedSkeleton',
    async function (request, reply) {
      const db = rawApp.blueskyBridge.db;
      const { authorization = '' } = request.headers;
      if (!authorization.startsWith('Bearer ')) {
        throw new UnauthorizedError();
      }
      const jwt = authorization.replace('Bearer ', '').trim();
      const [parsed, settings] = await Promise.all([
        verifyJwt(
          jwt,
          serviceDid,
          'app.bsky.feed.getFeedSkeleton',
          async (did: string) => {
            return app.blueskyBridge.didResolver.resolveAtprotoKey(did);
          }
        ),
        db.selectFrom('settings').selectAll().executeTakeFirstOrThrow(),
      ]);
      const userDid = parsed.iss;

      const params = request.query as Record<string, string>;
      const feed = params.feed;
      const limit = params.limit ? parseInt(params.limit) : 30;
      const offset = params.cursor ? parseInt(params.cursor) : 0;

      let query = db.selectFrom('post').select('uri');
      if (feed === hashtagFeedUri) {
        query = query.where((eb) =>
          eb.or([
            eb('post.author', '=', santaAccountDid).and(
              'post.replyParent',
              'is',
              null
            ),
            eb.and([
              eb('hasHashtag', '=', 1),
              ...(settings.feed_player_only ? [eb('byPlayer', '=', 1)] : []),
            ]),
          ])
        );
      } else if (feed === hashtagWithRepliesFeedUri) {
        if (settings.feed_player_only) {
          query = query.where((eb) =>
            eb.or([
              eb('post.author', '=', santaAccountDid).and(
                'post.replyParent',
                'is',
                null
              ),
              eb.and([
                eb('distanceFromPlayerWithHashtag', '>=', 0),
                eb(
                  'distanceFromPlayerWithHashtag',
                  '<=',
                  settings.feed_max_distance_from_tag
                ),
                eb('byPlayer', '=', 1),
              ]),
            ])
          );
        } else {
          query = query.where((eb) =>
            eb.or([
              eb('post.author', '=', santaAccountDid).and(
                'post.replyParent',
                'is',
                null
              ),
              eb.and([
                eb('distanceFromHashtag', '>=', 0),
                eb(
                  'distanceFromHashtag',
                  '<=',
                  settings.feed_max_distance_from_tag
                ),
              ]),
            ])
          );
        }
      } else if (feed === gifteeFeedUri) {
        const giftees = await queryFullMatch(db)
          .where('santa.did', '=', userDid)
          .where('match_status', '<>', 'draft')
          .clearSelect()
          .select('giftee.did as giftee_did')
          .execute();
        if (giftees.length === 0) {
          const output: Queries['app.bsky.feed.getFeedSkeleton']['output'] = {
            feed: [
              {
                post: NO_GIFTEE_POST,
              },
            ],
          };

          return reply.send(output);
        }
        query = query.where(
          'author',
          'in',
          giftees.map(({ giftee_did }) => giftee_did)
        );
      } else {
        throw new BadRequestError(`Unknown feed`);
      }

      query = query.orderBy('indexedAt desc').limit(offset + limit + 1);
      const result = await query.execute();
      if (result.length === 0 && feed === gifteeFeedUri) {
        const output: Queries['app.bsky.feed.getFeedSkeleton']['output'] = {
          feed: [
            {
              post: NO_POSTS_BY_GIFTEE,
            },
          ],
        };

        return reply.send(output);
      }
      const output: Queries['app.bsky.feed.getFeedSkeleton']['output'] = {
        feed: result.slice(offset, limit).map((row) => ({
          post: row.uri,
        })),
        cursor:
          result.length > offset + limit ? String(offset + limit) : undefined,
      };

      return reply.send(output);
    }
  );
};
