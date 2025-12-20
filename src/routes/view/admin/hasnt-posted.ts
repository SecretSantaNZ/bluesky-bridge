import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { type Database, queryFullMatch } from '../../../lib/database/index.js';

export function buildHasntPostedQuery(db: Database) {
  return queryFullMatch(db)
    .select((eb) => [
      eb
        .selectFrom('post')
        .select(({ fn }) => fn.max('post.indexedAt').as('lastPosted'))
        .whereRef('post.author', '=', 'giftee.did')
        .as('lastPosted'),
      eb
        .selectFrom('post')
        .select(({ fn }) => fn.max('post.indexedAt').as('lastHashtagged'))
        .whereRef('post.author', '=', 'giftee.did')
        .where('post.hasHashtag', '=', 1)
        .as('lastHashtagged'),
    ])
    .where('posted_opening', '=', 0);
}

export const hasntPosted: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get('/hasnt-posted', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [matches] = await Promise.all([buildHasntPostedQuery(db).execute()]);
    return reply.view('admin/hasnt-posted', {
      matches,
    });
  });
};
