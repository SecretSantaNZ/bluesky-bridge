import type { Database } from './index.js';

export function queryFullMatch(db: Database) {
  return db
    .selectFrom('match')
    .innerJoin('player as santa', 'santa.id', 'match.santa')
    .innerJoin('player as giftee', 'giftee.id', 'match.giftee')
    .select([
      'santa.handle as santa_handle',
      'santa.deactivated as santa_deactivated',
      'santa.avatar_url as santa_avatar_url',
      'santa.booted as santa_booted',
      'giftee.handle as giftee_handle',
      'giftee.deactivated as giftee_deactivated',
      'giftee.avatar_url as giftee_avatar_url',
      'giftee.booted as giftee_booted',
      'match.invalid_player as invalid_player',
      'match.id as match_id',
      'match.match_status',
      'match.nudge_count',
      'match.tracking_count',
      'match.nudge_present_update_count',
      'match.contacted',
      'match.tracking_count',
      'match.tracking_missing_count',
      'match.followup_action',
      'match.super_santa_match',
    ])
    .where('match.deactivated', 'is', null);
}
