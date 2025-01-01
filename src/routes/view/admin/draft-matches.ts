import type { FastifyPluginAsync } from 'fastify';
import {
  buildBrokenMatchesQuery,
  buildTooManyGifteeMatchesQuery,
  buildTooManySantasMatchesQuery,
} from './fix-matches.js';

export const draftMatches: FastifyPluginAsync = async (app) => {
  app.get('/draft-matches', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [
      { cnt: countNeedsSantaAssigned },
      draftMatches,
      { cnt: brokenMatchCount },
      { cnt: tooManyGifteesCount },
      { cnt: tooManySantasCount },
    ] = await Promise.all([
      db
        .selectFrom('player')
        .select(({ fn }) => fn.countAll<number>().as('cnt'))
        .where('signup_complete', '=', 1)
        .where('giftee_for_count', '=', 0)
        .where('game_mode', '<>', 'Santa Only')
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('match')
        .innerJoin('player as santa', 'santa.id', 'match.santa')
        .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
        .select([
          'santa.handle as santa_handle',
          'santa.deactivated as santa_deactivated',
          'santa.booted as santa_booted',
          'giftee.handle as giftee_handle',
          'giftee.deactivated as giftee_deactivated',
          'giftee.booted as giftee_booted',
          'match.invalid_player as invalid_player',
          'match.id as match_id',
          'match.match_status',
        ])
        .where('match.match_status', '=', 'draft')
        .where('match.deactivated', 'is', null)
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
    ]);
    return reply.view(
      'admin/draft-matches.ejs',
      {
        countNeedsSantaAssigned,
        draftMatches,
        criticalMatchIssues: brokenMatchCount + tooManyGifteesCount,
        warnMatchIssues: tooManySantasCount,
        oneColumn: true,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
