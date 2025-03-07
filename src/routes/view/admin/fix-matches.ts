import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import type { Database } from '../../../lib/database/index.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

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
      'santa.avatar_url as santa_avatar_url',
      'santa.note_count as santa_note_count',
      'santa.booted as santa_booted',
      'giftee.handle as giftee_handle',
      'giftee.deactivated as giftee_deactivated',
      'giftee.avatar_url as giftee_avatar_url',
      'giftee.note_count as giftee_note_count',
      'giftee.booted as giftee_booted',
      'match.id as match_id',
      'match.match_status',
    ])
    .where('santa.giftee_count_status', '=', 'too_many')
    .where('match.deactivated', 'is', null)
    .orderBy('santa.id asc')
    .orderBy('match.id asc');
}

export function buildBrokenMatchesQuery(db: Database) {
  return db
    .selectFrom('match')
    .innerJoin('player as santa', 'santa.id', 'match.santa')
    .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
    .select([
      'santa.handle as santa_handle',
      'santa.deactivated as santa_deactivated',
      'santa.avatar_url as santa_avatar_url',
      'santa.note_count as santa_note_count',
      'santa.booted as santa_booted',
      'giftee.handle as giftee_handle',
      'giftee.deactivated as giftee_deactivated',
      'giftee.avatar_url as giftee_avatar_url',
      'giftee.note_count as giftee_note_count',
      'giftee.booted as giftee_booted',
      'match.id as match_id',
      'match.match_status',
    ])
    .where('match.invalid_player', '=', 1)
    .where('match.deactivated', 'is', null)
    .orderBy('match.id asc');
}

export function buildTooManySantasMatchesQuery(db: Database) {
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
      'santa.avatar_url as santa_avatar_url',
      'santa.note_count as santa_note_count',
      'santa.booted as santa_booted',
      'giftee.handle as giftee_handle',
      'giftee.deactivated as giftee_deactivated',
      'giftee.avatar_url as giftee_avatar_url',
      'giftee.note_count as giftee_note_count',
      'giftee.booted as giftee_booted',
      'match.id as match_id',
      'match.match_status',
    ])
    .where('giftee.giftee_for_count', '>', 1)
    .where('match.deactivated', 'is', null)
    .orderBy('giftee.id asc')
    .orderBy('match.id asc');
}

export const fixMatches: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/fix-matches',
    {
      schema: {
        querystring: z
          .object({
            data: z.enum(['true', 'false']),
          })
          .partial(),
      },
    },
    async function (request, reply) {
      const { db } = this.blueskyBridge;
      const [
        playersWhoCanHaveMoreGifees,
        brokenMatches,
        tooManyGifteeMatches,
        needsSantaAssigned,
        tooManySantasMatches,
      ] = await Promise.all([
        db
          .selectFrom('player')
          .select([
            'handle',
            'did',
            'avatar_url',
            'note_count',
            'giftee_count',
            'giftee_for_count',
            'max_giftees',
          ])
          .where('giftee_count_status', '=', 'can_have_more')
          .where('signup_complete', '=', 1)
          .orderBy(
            sql`giftee_count - (case when giftee_for_count > 0 then 1 else 0 end) asc`
          )
          .orderBy(sql`random()`)
          .execute(),
        buildBrokenMatchesQuery(db).execute(),
        buildTooManyGifteeMatchesQuery(db).execute(),
        db
          .selectFrom('player')
          .selectAll()
          .where('signup_complete', '=', 1)
          .where('giftee_for_count', '=', 0)
          .where('game_mode', '<>', 'Santa Only')
          .execute(),
        buildTooManySantasMatchesQuery(db).execute(),
      ]);
      const pageData = {
        playersWhoCanHaveMoreGifees,
        brokenMatches,
        tooManyGifteeMatches,
        needsSantaAssigned,
        tooManySantasMatches,
      };
      if (request.query.data === 'true') {
        return reply.send(pageData);
      }
      return reply.view(
        'admin/fix-matches.ejs',
        {
          pageData,
          oneColumn: true,
        },
        {
          layout: 'layouts/base-layout.ejs',
        }
      );
    }
  );
};
