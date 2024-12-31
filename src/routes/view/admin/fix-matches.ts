import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import type { Database } from '../../../lib/database/index.js';

export function buildTooManyGifteeMatchesQuery(db: Database) {
  return db
    .selectFrom('match')
    .innerJoin('player as santa', 'santa.id', 'match.santa')
    .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
    .select([
      'santa.did',
      'santa.handle',
      'santa.game_mode',
      'santa.max_giftees',
      'santa.handle as santa_handle',
      'santa.deactivated as santa_deactivated',
      'santa.booted as santa_booted',
      'giftee.handle as giftee_handle',
      'giftee.deactivated as giftee_deactivated',
      'giftee.booted as giftee_booted',
      'match.id as match_id',
      'match.match_status',
    ])
    .where('santa.giftee_count_status', '=', 'too_many')
    .where('match.deactivated', 'is', null)
    .orderBy('santa.id asc')
    .orderBy('match.id asc');
}

export const fixMatches: FastifyPluginAsync = async (app) => {
  app.get('/fix-matches', async function (request, reply) {
    const { db } = this.blueskyBridge;
    const [
      playersWhoCanHaveMoreGifees,
      brokenMatches,
      tooManyGifteeMatches,
      needsSantaAssigned,
    ] = await Promise.all([
      db
        .selectFrom('player')
        .select([
          'handle',
          'did',
          'giftee_count',
          'giftee_for_count',
          'max_giftees',
        ])
        .where('giftee_count_status', '=', 'can_have_more')
        .where('signup_complete', '=', 1)
        .orderBy('giftee_count asc')
        .orderBy(sql`random()`)
        .execute(),
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
          'match.id as match_id',
          'match.match_status',
        ])
        .where('match.invalid_player', '=', 1)
        .where('match.deactivated', 'is', null)
        .orderBy('match.id asc')
        .execute(),
      buildTooManyGifteeMatchesQuery(db).execute(),
      db
        .selectFrom('player')
        .selectAll()
        .where('signup_complete', '=', 1)
        .where('giftee_for_count', '=', 0)
        .execute(),
    ]);
    return reply.view(
      'admin/fix-matches.ejs',
      {
        playersWhoCanHaveMoreGifees,
        brokenMatches,
        tooManyGifteeMatches,
        needsSantaAssigned,
        oneColumn: true,
      },
      {
        layout: 'layouts/base-layout.ejs',
      }
    );
  });
};
