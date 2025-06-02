import type { FastifyPluginAsync } from 'fastify';
import {
  buildBrokenMatchesQuery,
  buildMultipleGifteeMatchesQuery,
  buildTooManyGifteeMatchesQuery,
  buildTooManySantasMatchesQuery,
} from './fix-matches.js';
import { queryFullMatch } from '../../../lib/database/index.js';

export const draftMatches: FastifyPluginAsync = async (app) => {
  app.get('/draft-matches', async function (request, reply) {
    const { db } = this.blueskyBridge;
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
        .orderBy('match.id asc')
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
    const pageData = {
      countNeedsSantaAssigned,
      draftMatches,
      criticalMatchIssues: brokenMatchCount + tooManyGifteesCount,
      warnMatchIssues: tooManySantasCount + multipleGifteesCount,
    };
    return reply.view(
      'admin/draft-matches.ejs',
      {
        pageData,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
