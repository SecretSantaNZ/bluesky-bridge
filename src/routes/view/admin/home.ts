import type { FastifyPluginAsync } from 'fastify';
import {
  buildBrokenMatchesQuery,
  buildTooManyGifteeMatchesQuery,
  buildTooManySantasMatchesQuery,
} from './fix-matches.js';

export const adminHome: FastifyPluginAsync = async (app) => {
  app.get('/', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [
      { signupCompleteCount },
      { registeredPlayersCount },
      { cnt: brokenMatchCount },
      { cnt: tooManyGifteesCount },
      { cnt: tooManySantasCount },
      { cnt: playersNeedingMatchesCount },
      { cnt: unsentMatches },
      { cnt: sharedMatches },
      { cnt: lockedMatches },
    ] = await Promise.all([
      db
        .selectFrom('player')
        .select(({ fn }) => fn.countAll().as('signupCompleteCount'))
        .where('signup_complete', '=', 1)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('player')
        .select(({ fn }) => fn.countAll().as('registeredPlayersCount'))
        .where('deactivated', '=', 0)
        .executeTakeFirstOrThrow(),
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
      db
        .selectFrom('player')
        .select(({ fn }) => fn.countAll<number>().as('cnt'))
        .where('signup_complete', '=', 1)
        .where('giftee_for_count', '=', 0)
        .where('game_mode', '<>', 'Santa Only')
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('match')
        .select(({ fn }) => fn.countAll<number>().as('cnt'))
        .where('match_status', '=', 'draft')
        .where('deactivated', 'is', null)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('match')
        .select(({ fn }) => fn.countAll<number>().as('cnt'))
        .where('match_status', '=', 'shared')
        .where('deactivated', 'is', null)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('match')
        .select(({ fn }) => fn.countAll<number>().as('cnt'))
        .where('match_status', '=', 'locked')
        .where('deactivated', 'is', null)
        .executeTakeFirstOrThrow(),
    ]);
    return reply.view(
      'admin/home.ejs',
      {
        signupCompleteCount,
        registeredPlayersCount,
        criticalMatchIssues: brokenMatchCount + tooManyGifteesCount,
        warnMatchIssues: tooManySantasCount,
        playersNeedingMatchesCount,
        unsentMatches,
        sharedMatches,
        lockedMatches,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
