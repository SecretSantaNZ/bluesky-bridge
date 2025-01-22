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
      { cnt: sentNudgeCount },
      { cnt: nudgeCount },
      { cnt: sentTrackingCount },
      { cnt: trackingCount },
      { cnt: presentsToFollowUpCount },
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
      db
        .selectFrom('nudge')
        .select(({ fn }) => fn.countAll<number>().as('cnt'))
        .where('nudge_status', '=', 'sent')
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('nudge')
        .select(({ fn }) => fn.countAll<number>().as('cnt'))
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('tracking')
        .select(({ fn }) => fn.countAll<number>().as('cnt'))
        .where('deactivated', 'is', null)
        .where('tracking_status', '=', 'sent')
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('tracking')
        .select(({ fn }) => fn.countAll<number>().as('cnt'))
        .where('deactivated', 'is', null)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('match')
        .select(({ fn }) => fn.countAll<number>().as('cnt'))
        .where('match_status', '=', 'locked')
        .where('deactivated', 'is', null)
        .where('followup_action', 'is', null)
        .where((eb) =>
          eb.or([
            eb('tracking_count', '=', 0),
            eb('tracking_missing_count', '>', 0),
          ])
        )
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
        sentNudgeCount,
        nudgeCount,
        sentTrackingCount,
        trackingCount,
        presentsToFollowUpCount,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
