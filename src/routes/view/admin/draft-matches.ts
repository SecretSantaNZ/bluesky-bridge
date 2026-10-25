import type { FastifyPluginAsync } from 'fastify';
import {
  buildBrokenMatchesQuery,
  buildMultipleGifteeMatchesQuery,
  buildTooManyGifteeMatchesQuery,
  buildTooManySantasMatchesQuery,
} from './fix-matches.js';
import { queryFullMatch, type Database } from '../../../lib/database/index.js';

export async function draftMatchesData(db: Database) {
  const [
    { cnt: countNeedsSantaAssigned },
    draftMatches,
    { cnt: brokenMatchCount },
    { cnt: tooManyGifteesCount },
    { cnt: tooManySantasCount },
    { cnt: multipleGifteesCount },
  ] = await Promise.all([
    db
      .selectFrom('player')
      .select(({ fn }) => fn.countAll<number>().as('cnt'))
      .where('signup_complete', '=', 1)
      .where('giftee_for_count', '=', 0)
      .where('game_mode', '<>', 'Santa Only')
      .executeTakeFirstOrThrow(),
    queryFullMatch(db)
      .where('match.match_status', '=', 'draft')
      .orderBy('match.id', 'asc')
      .execute(),
    buildBrokenMatchesQuery(db)
      .clearSelect()
      .select(({ fn }) => fn.countAll<number>().as('cnt'))
      .executeTakeFirstOrThrow(),
    buildTooManyGifteeMatchesQuery(db)
      .clearSelect()
      .select(({ fn }) => fn.countAll<number>().as('cnt'))
      .executeTakeFirstOrThrow(),
    buildTooManySantasMatchesQuery(db)
      .clearSelect()
      .select(({ fn }) => fn.countAll<number>().as('cnt'))
      .executeTakeFirstOrThrow(),
    buildMultipleGifteeMatchesQuery(db)
      .clearSelect()
      .select(({ fn }) => fn.countAll<number>().as('cnt'))
      .where('santa.giftee_count_no_super', '>', 1)
      .executeTakeFirstOrThrow(),
  ]);
  return {
    countNeedsSantaAssigned,
    draftMatches,
    criticalMatchIssues: brokenMatchCount + tooManyGifteesCount,
    warnMatchIssues: tooManySantasCount + multipleGifteesCount,
  };
}

export const draftMatches: FastifyPluginAsync = async (app) => {
  app.get('/draft-matches', async function (request, reply) {
    const { db } = this.blueskyBridge;
    return reply.view('admin/draft-matches', {
      pageData: await draftMatchesData(db),
    });
  });
};
