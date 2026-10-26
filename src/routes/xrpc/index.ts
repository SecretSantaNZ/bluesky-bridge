import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { InferOutput, ResourceUri, Did } from '@atcute/lexicons';
import type { XRPCQueries } from '@atcute/lexicons/ambient';
import '@atcute/bluesky';
import { BadRequestError, UnauthorizedError } from 'http-errors-enhanced';
import { verifyJwt } from '@atproto/xrpc-server';
import { queryFullMatch } from '../../lib/database/index.js';
import type { Database } from '../../lib/database/index.js';
import type { SelectedSettings } from '../../lib/settings.js';

const NO_GIFTEE_POST =
  'at://did:plc:qaspeclp3zntiiaywz57zwza/app.bsky.feed.post/3lgn2zw3u2k2u';
const NO_POSTS_BY_GIFTEE =
  'at://did:plc:qaspeclp3zntiiaywz57zwza/app.bsky.feed.post/3lgn345mw2k2u';

export type FeedSkeletonParams = {
  feed: string | undefined;
  userDid: string;
  limit?: number | string;
  cursor?: string;
};

export function buildFeedUris(santaAccountDid: string) {
  return {
    gifteeFeedUri:
      `at://${santaAccountDid}/app.bsky.feed.generator/3lgklut3vkw6t` as ResourceUri,
    hashtagFeedUri:
      `at://${santaAccountDid}/app.bsky.feed.generator/3lgmzql3sv6vk` as ResourceUri,
    hashtagWithRepliesFeedUri:
      `at://${santaAccountDid}/app.bsky.feed.generator/3lgmzr7qohmva` as ResourceUri,
  };
}

/** Builds a feed skeleton response for getFeedSkeleton from the database.
 *  Decides which posts belong in the requested feed, serves sentinel posts
 *  when the giftee feed would be empty, and handles cursor pagination. */
export async function getFeedSkeletonOutput(
  db: Database,
  settings: SelectedSettings,
  santaAccountDid: string,
  params: FeedSkeletonParams
) {
  const { gifteeFeedUri, hashtagFeedUri, hashtagWithRepliesFeedUri } =
    buildFeedUris(santaAccountDid);

  const userDid = params.userDid;

  // Clamp to safe bounds. SQLite treats a negative LIMIT as unbounded and
  // a huge LIMIT causes a full table scan, and a huge offset is similarly
  // a full scan before the slice below. The Bluesky spec caps limit at
  // 100, and cursors beyond 10k posts are unreachable for these feeds
  // (posts are purged after 90 days).
  const limit = Math.min(100, Math.max(1, parseSafeInt(params.limit, 30)));
  const offset = Math.min(10_000, Math.max(0, parseSafeInt(params.cursor, 0)));

  let query = db.selectFrom('post').select('uri');
  if (params.feed === hashtagFeedUri) {
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
  } else if (params.feed === hashtagWithRepliesFeedUri) {
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
  } else if (params.feed === gifteeFeedUri) {
    const giftees = await queryFullMatch(db)
      .where('santa.did', '=', userDid)
      .where('match_status', '<>', 'draft')
      .clearSelect()
      .select('giftee.did as giftee_did')
      .execute();
    if (giftees.length === 0) {
      const output: InferOutput<
        XRPCQueries['app.bsky.feed.getFeedSkeleton']['output']['schema']
      > = {
        feed: [
          {
            post: NO_GIFTEE_POST,
          },
        ],
      };

      return output;
    }
    query = query.where(
      'author',
      'in',
      giftees.map(({ giftee_did }) => giftee_did)
    );
  } else {
    throw new BadRequestError(`Unknown feed`);
  }

  query = query.orderBy('indexedAt', 'desc').limit(offset + limit + 1);
  const result = await query.execute();
  if (result.length === 0 && params.feed === gifteeFeedUri) {
    const output: InferOutput<
      XRPCQueries['app.bsky.feed.getFeedSkeleton']['output']['schema']
    > = {
      feed: [
        {
          post: NO_POSTS_BY_GIFTEE,
        },
      ],
    };

    return output;
  }

  const output: InferOutput<
    XRPCQueries['app.bsky.feed.getFeedSkeleton']['output']['schema']
  > = {
    feed: result.slice(offset, offset + limit).map((row) => ({
      post: row.uri as ResourceUri,
    })),
    cursor: result.length > offset + limit ? String(offset + limit) : undefined,
  };

  return output;
}

/**
 * Parses an integer query parameter, falling back to the default for missing
 * or unparsable values.
 */
const parseSafeInt = (
  value: string | number | undefined,
  fallback: number
): number => {
  if (value == null) {
    return fallback;
  }
  const parsed = parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
};

export const xrpc: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  const serviceDid: Did = `did:web:${process.env.TOKEN_ISSUER}`;
  const santaAccountDid = rawApp.blueskyBridge.santaAccountDid;
  const { gifteeFeedUri, hashtagFeedUri, hashtagWithRepliesFeedUri } =
    buildFeedUris(santaAccountDid);
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
    const output: InferOutput<
      XRPCQueries['app.bsky.feed.describeFeedGenerator']['output']['schema']
    > = {
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

      const params = request.query as Record<string, string>;

      return reply.send(
        await getFeedSkeletonOutput(db, settings, santaAccountDid, {
          feed: params.feed,
          userDid: parsed.iss,
          limit: params.limit,
          cursor: params.cursor,
        })
      );
    }
  );
};
