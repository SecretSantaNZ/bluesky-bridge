import { sql } from 'kysely';
import type { Database } from './index.js';

export async function loadPlayersWhoCanHaveMoreGifees(db: Database) {
  return db
    .selectFrom('player')
    .select([
      'id',
      'handle',
      'did',
      'address_location',
      'avatar_url',
      'note_count',
      'giftee_count',
      'giftee_for_count',
      'max_giftees',
    ])
    .where('giftee_count_status', '=', 'can_have_more')
    .where('signup_complete', '=', 1)
    .orderBy(
      sql`giftee_count - (case when giftee_for_count > 0 then 1 else 0 end)`,
      'asc'
    )
    .orderBy(
      sql`case when game_mode = 'Santa Only' and giftee_count = 0 then 1 else giftee_count end`,
      'asc'
    )
    .orderBy(sql`random()`)
    .execute();
}
