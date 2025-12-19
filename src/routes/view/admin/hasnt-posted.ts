import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { type Database, queryFullMatch } from '../../../lib/database/index.js';
import { loadSettings } from '../../../lib/settings.js';
import { formatISO, parseISO } from 'date-fns';
import { tz } from '@date-fns/tz';

export function buildHasntPostedQuery(db: Database, openingDate: string) {
  const startdate = parseISO(openingDate + 'T00:00:00.000', {
    in: tz('Pacific/Auckland'),
  });
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
    .where((eb) =>
      eb(
        eb
          .selectFrom('post')
          .select(eb.fn.countAll().as('cnt'))
          .whereRef('post.author', '=', 'giftee.did')
          .where('post.hasHashtag', '=', 1)
          .where(
            'post.indexedAt',
            '>=',
            formatISO(startdate, { in: tz('UTC') })
          ),
        '=',
        0
      )
    );
}

export const hasntPosted: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get('/hasnt-posted', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const settings = await loadSettings(db);
    const [matches] = await Promise.all([
      buildHasntPostedQuery(db, settings.opening_date).execute(),
    ]);
    return reply.view('admin/hasnt-posted', {
      matches,
    });
  });
};
